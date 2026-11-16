// ---------------------------------------------------------------- building & home base
// Structures are built from blueprints, block by block, then checked block by block, so a
// "built" report is real. The base (home + structures) is remembered across restarts: Voyager
// re-injects it as _V_BASE_SAVED and records changes from bot.save("base:{...}").

var _V_AIR = new Set(["air", "cave_air", "void_air"]);
var _V_INTERACTIVE = /(chest|crafting_table|furnace|_bed|_door|_fence_gate|barrel|smoker|anvil|lever|_button|trapdoor|enchanting_table|brewing_stand|hopper|dispenser|dropper|loom|cartography_table|smithing_table|stonecutter|grindstone|bell|note_block|composter|_sign)$/;
var _V_WALL_ITEMS = ["cobblestone", "cobbled_deepslate", "stone_bricks", "bricks", "stone", "deepslate_bricks", "mud_bricks"];
var _V_FILL_ITEMS = ["dirt", "andesite", "diorite", "granite", "tuff", "netherrack", "calcite"];
var _V_SOIL = ["dirt", "grass_block", "coarse_dirt", "podzol", "rooted_dirt", "farmland", "dirt_path"];

// ---- base memory
function getBase(bot) {
    if (!bot._V_base) {
        let saved = null;
        try {
            saved = typeof _V_BASE_SAVED !== "undefined" ? _V_BASE_SAVED : null;
        } catch (e) { /* not injected (e.g. benchmark) */ }
        bot._V_base = saved ? JSON.parse(JSON.stringify(saved)) : { home: null, structures: [] };
        if (!bot._V_base.structures) bot._V_base.structures = [];
        _V_protectBase(bot);
    }
    return bot._V_base;
}

function _V_saveBase(bot) {
    bot.save("base:" + JSON.stringify(getBase(bot)));
}

function _V_v(o) {
    return new Vec3(o.x, o.y, o.z);
}

function _V_plain(v) {
    return { x: v.x, y: v.y, z: v.z };
}

function _V_inBox(p, box, m = 0) {
    return p.x >= box.min.x - m && p.x <= box.max.x + m && p.y >= box.min.y - m && p.y <= box.max.y + m &&
        p.z >= box.min.z - m && p.z <= box.max.z + m;
}

function _V_boxesOverlap(a, b, m = 0) {
    return a.min.x - m <= b.max.x && a.max.x + m >= b.min.x && a.min.z - m <= b.max.z && a.max.z + m >= b.min.z;
}

// the nearest recorded structure of a type (hut, storage, farm, pen)
function _V_structure(bot, type) {
    const list = getBase(bot).structures.filter((s) => s.type === type);
    if (!list.length) return null;
    const me = bot.entity.position;
    return list.sort((a, b) => _V_v(a.origin).distanceTo(me) - _V_v(b.origin).distanceTo(me))[0];
}

// never let the pathfinder dig through our own buildings
function _V_protectBase(bot) {
    const mv = bot.pathfinder && bot.pathfinder.movements;
    if (!mv || !mv.exclusionAreasBreak) return;
    if (!bot._V_protectFn) {
        bot._V_protectFn = (block) => {
            const base = bot._V_base;
            if (!base || !base.structures.length || !block || !block.position) return 0;
            return base.structures.some((s) => s.box && _V_inBox(block.position, s.box)) ? 100 : 0;
        };
    }
    if (!mv.exclusionAreasBreak.includes(bot._V_protectFn)) mv.exclusionAreasBreak.push(bot._V_protectFn);
}

// ---- getting around
async function _V_travel(bot, pos, range = 1, ms = 180000) {
    const end = Date.now() + ms;
    const close = () => bot.entity.position.distanceTo(pos.offset(0.5, 0, 0.5)) <= range + 0.75;
    while (!close() && Date.now() < end) {
        const goal = range <= 0 ? new GoalBlock(pos.x, pos.y, pos.z) : new GoalNear(pos.x, pos.y, pos.z, range);
        try {
            await _V_goto(bot, goal, Math.max(5000, Math.min(60000, end - Date.now())));
        } catch (e) {
            await bot.waitForTicks(10);
        }
    }
    return close();
}

// walk in a straight line to the middle of a cell (used through doors and gates, which the
// pathfinder will not open)
async function _V_walkTo(bot, cell, ms = 5000) {
    const target = cell.offset(0.5, 0, 0.5);
    const end = Date.now() + ms;
    try {
        while (Date.now() < end) {
            const p = bot.entity.position;
            if (Math.hypot(p.x - target.x, p.z - target.z) < 0.3) break;
            await bot.lookAt(target.offset(0, bot.entity.height * 0.9, 0), true);
            bot.setControlState("forward", true);
            await bot.waitForTicks(1);
        }
    } finally {
        bot.clearControlStates();
    }
    return Math.hypot(bot.entity.position.x - target.x, bot.entity.position.z - target.z) < 0.6;
}

function _V_isOpen(block) {
    try {
        return !!block.getProperties().open;
    } catch (e) {
        return false;
    }
}

// go through a door or gate at `at`, from cell `from` to cell `to`, closing it behind us
// (unless keepOpen, e.g. so animals can follow us in)
async function _V_passDoor(bot, at, from, to, keepOpen = false) {
    await _V_travel(bot, from, 0, 60000);
    let door = bot.blockAt(at);
    if (door && /(_door|_fence_gate)$/.test(door.name) && !_V_isOpen(door)) {
        await bot.activateBlock(door).catch(() => {});
        await bot.waitForTicks(4);
    }
    const ok = await _V_walkTo(bot, to, 5000);
    door = bot.blockAt(at);
    if (!keepOpen && door && /(_door|_fence_gate)$/.test(door.name) && _V_isOpen(door)) {
        await bot.activateBlock(door).catch(() => {});
        await bot.waitForTicks(2);
    }
    return ok;
}

function _V_insideBox(bot, box) {
    return _V_inBox(bot.entity.position.floored(), { min: { x: box.min.x + 1, y: box.min.y, z: box.min.z + 1 },
        max: { x: box.max.x - 1, y: box.max.y, z: box.max.z - 1 } });
}

// ---- site selection
function _V_ground(bot, x, z, yHint, cache) {
    const key = x + "," + z;
    if (cache.has(key)) return cache.get(key);
    let r = null;
    for (let y = yHint + 8; y >= yHint - 10; y--) {
        const b = bot.blockAt(new Vec3(x, y, z));
        if (!b) break;
        if (b.name === "water" || b.name === "lava") {
            r = { y, liquid: true, name: b.name };
            break;
        }
        if (b.boundingBox === "block" && !/leaves|_log$|_wood$|_stem$|mushroom_block/.test(b.name)) {
            r = { y, name: b.name };
            break;
        }
    }
    cache.set(key, r);
    return r;
}

// find a flat, dry w x d spot; returns the origin (standing level; floor is y-1)
function _V_findSite(bot, w, d, opts = {}) {
    const center = opts.near ? _V_v(opts.near) : bot.entity.position.floored();
    const yHint = Math.floor(center.y);
    const cache = new Map();
    const base = getBase(bot);
    const m = opts.margin === undefined ? 1 : opts.margin;
    const R = opts.radius || 24;
    let best = null;
    for (let ox = center.x - R; ox <= center.x + R; ox += 2) {
        for (let oz = center.z - R; oz <= center.z + R; oz += 2) {
            const dist = Math.hypot(ox + w / 2 - center.x, oz + d / 2 - center.z);
            if (dist > R || dist < (opts.minDist || 0)) continue;
            const box = { min: { x: ox - m, z: oz - m }, max: { x: ox + w - 1 + m, z: oz + d - 1 + m } };
            if (base.structures.some((s) => s.box && _V_boxesOverlap(box, s.box, 1))) continue;
            const hs = [];
            let bad = false;
            let notSoil = 0;
            let trees = 0;
            let wet = 0;
            for (let x = ox - m; x < ox + w + m && !bad; x++) {
                for (let z = oz - m; z < oz + d + m; z++) {
                    const inFoot = x >= ox && x < ox + w && z >= oz && z < oz + d;
                    const g = _V_ground(bot, x, z, yHint, cache);
                    // water may border a farm (it is irrigation); anything else floods when we dig
                    if (!g || (g.liquid && (inFoot || !opts.soil))) {
                        bad = true;
                        break;
                    }
                    if (!inFoot) {
                        if (g.liquid) wet++; // water around the edge is fine, just less nice
                        continue;
                    }
                    hs.push(g.y);
                    if (!_V_SOIL.includes(g.name)) notSoil++;
                    const t = bot.blockAt(new Vec3(x, g.y + 2, z));
                    if (t && /_log$/.test(t.name)) trees++;
                }
            }
            if (bad || !hs.length) continue;
            const counts = {};
            for (const h of hs) counts[h] = (counts[h] || 0) + 1;
            const mode = Number(Object.keys(counts).reduce((a, b) => (counts[a] >= counts[b] ? a : b)));
            if (Math.max(...hs) - Math.min(...hs) > 3) continue;
            const dev = hs.reduce((a, h) => a + Math.abs(h - mode), 0);
            const cost = dev * 2 + trees * 4 + wet * 2 + (opts.soil ? notSoil * 3 : 0) + dist * 0.5;
            if (!best || cost < best.cost) best = { cost, origin: new Vec3(ox, mode + 1, oz) };
        }
    }
    return best ? best.origin : null;
}

// ---- blueprints. Entry: {p:[dx,dy,dz], b: what, phase, stand?, ref?}. dy=-1 is the floor/ground.
// "what": "*solid" (any solid block), "wall" (cobblestone or similar), "planks" (any), "bed", "door",
// "fence", "fence_gate", "torch", "farmland", "water", or an exact block name.
function _V_blueprint(type) {
    const E = [];
    const add = (x, y, z, b, extra = {}) => E.push(Object.assign({ p: [x, y, z], b, phase: 0 }, extra));
    if (type === "hut") {
        // 5x5 cottage: cobblestone walls, plank roof, door facing -z; inside a bed, chest,
        // crafting table, furnace and a torch
        for (let x = 0; x < 5; x++) for (let z = 0; z < 5; z++) add(x, -1, z, "*solid");
        add(2, -1, -1, "*solid", { optional: true }); // doorstep path
        add(2, -1, -2, "*solid", { optional: true });
        for (let y = 0; y < 3; y++)
            for (let x = 0; x < 5; x++)
                for (let z = 0; z < 5; z++) {
                    if (x > 0 && x < 4 && z > 0 && z < 4) continue;
                    if (x === 2 && z === 0 && y < 2) continue; // doorway
                    add(x, y, z, "wall", { phase: 1 });
                }
        add(1, 0, 2, "bed", { phase: 2, stand: [1, 0, 1] }); // head goes to (1,0,3)
        add(2, 0, 3, "chest", { phase: 2 });
        add(3, 0, 3, "crafting_table", { phase: 2 });
        add(3, 0, 2, "furnace", { phase: 2 });
        add(2, 1, 3, "torch", { phase: 2, ref: [2, 1, 4], optional: true });
        for (let x = 0; x < 5; x++)
            for (let z = 0; z < 5; z++) add(x, 3, z, "planks", { phase: 3, ring: Math.min(x, z, 4 - x, 4 - z) });
        add(2, 0, 0, "door", { phase: 4, stand: [2, 0, -2] });
        add(2, 2, -1, "torch", { phase: 5, ref: [2, 2, 0], stand: [2, 0, -2], optional: true });
        return {
            type, w: 5, d: 5, entries: E, clear: { min: [0, 0, 0], max: [4, 3, 4] },
            extraClear: [[2, 0, -1], [2, 1, -1], [2, 0, -2], [2, 1, -2]],
            box: { min: [0, -1, 0], max: [4, 3, 4] },
            marks: { doorAt: [2, 0, 0], outside: [2, 0, -1], inside: [2, 0, 1], bed: [1, 0, 2], chest: [2, 0, 3], centre: [2, 0, 2] },
        };
    }
    if (type === "storage") {
        // a covered row of 4 chests (2 double chests) with a torch
        for (let x = 0; x < 4; x++) {
            add(x, -1, 0, "*solid");
            add(x, -1, 1, "*solid");
            add(x, 0, 0, "chest", { phase: 1, stand: [x, 0, 1] });
        }
        add(0, 1, 1, "torch", { phase: 2, ref: [0, 0, 1], optional: true });
        return {
            type, w: 4, d: 2, entries: E, clear: { min: [0, 0, 0], max: [3, 1, 1] },
            box: { min: [0, -1, 0], max: [3, 1, 0] },
            marks: { stand: [1, 0, 1], chests: [[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0]] },
        };
    }
    if (type === "farm") {
        // 7x7 wheat field watered from the middle, inside a fence with a gate on the -z side
        for (let x = 0; x < 9; x++)
            for (let z = 0; z < 9; z++) {
                const border = x === 0 || z === 0 || x === 8 || z === 8;
                if (border) {
                    add(x, -1, z, "*solid");
                    if (!(x === 4 && z === 0)) add(x, 0, z, "fence", { phase: 3 });
                } else if (x === 4 && z === 4) add(x, -1, z, "water", { phase: 1 });
                // the pathfinder hops when stepping between farmland and dirt, which tramples some
                // tiles back to dirt; buildWheatFarm re-tills those from inside while planting
                else add(x, -1, z, "farmland", { phase: 2, optional: true });
            }
        add(4, -1, -1, "*solid");
        add(4, 0, 0, "fence_gate", { phase: 4, stand: [4, 0, -2] });
        return {
            type, w: 9, d: 9, entries: E, clear: { min: [0, 0, 0], max: [8, 2, 8] },
            extraClear: [[4, 0, -1], [4, 1, -1], [4, 0, -2], [4, 1, -2]], soil: true,
            box: { min: [0, -1, 0], max: [8, 2, 8] },
            marks: { gate: [4, 0, 0], outside: [4, 0, -1], inside: [4, 0, 1], centre: [4, 0, 3] },
        };
    }
    if (type === "pen") {
        // 5x5 animal pen inside a fence, gate on the -z side
        for (let x = 0; x < 7; x++)
            for (let z = 0; z < 7; z++) {
                const border = x === 0 || z === 0 || x === 6 || z === 6;
                add(x, -1, z, "*solid");
                if (border && !(x === 3 && z === 0)) add(x, 0, z, "fence", { phase: 1 });
            }
        add(3, -1, -1, "*solid");
        add(3, 0, 0, "fence_gate", { phase: 2, stand: [3, 0, -2] });
        return {
            type, w: 7, d: 7, entries: E, clear: { min: [0, 0, 0], max: [6, 2, 6] },
            extraClear: [[3, 0, -1], [3, 1, -1], [3, 0, -2], [3, 1, -2]],
            box: { min: [0, -1, 0], max: [6, 2, 6] },
            marks: { gate: [3, 0, 0], outside: [3, 0, -1], inside: [3, 0, 1], centre: [3, 0, 4] },
        };
    }
    throw new Error(`No blueprint called ${type} (try hut, storage, farm, pen)`);
}

// ---- what a blueprint needs
function _V_ok(block, want) {
    if (!block) return false;
    const n = block.name;
    switch (want) {
        case "*solid": return block.boundingBox === "block" && n !== "water" && n !== "lava";
        case "wall": return _V_WALL_ITEMS.includes(n) || ["deepslate", "andesite", "diorite", "granite", "tuff"].includes(n) || n.endsWith("_planks");
        case "planks": return n.endsWith("_planks") || _V_WALL_ITEMS.includes(n);
        case "bed": return n.endsWith("_bed");
        case "door": return n.endsWith("_door");
        case "fence": return n.endsWith("_fence");
        case "fence_gate": return n.endsWith("_fence_gate");
        case "torch": return n === "torch" || n === "wall_torch";
        case "farmland": return n === "farmland";
        case "wheat": return n === "wheat";
        case "water": return n === "water";
        default: return n === want;
    }
}

function _V_itemFor(bot, want) {
    const items = bot.inventory.items();
    const pick = (f) => items.find(f);
    switch (want) {
        case "wall": return pick((i) => _V_WALL_ITEMS.includes(i.name));
        case "*solid": return pick((i) => _V_FILL_ITEMS.includes(i.name)) || pick((i) => _V_WALL_ITEMS.includes(i.name)) ||
            pick((i) => i.name.endsWith("_planks"));
        case "planks": return pick((i) => i.name.endsWith("_planks"));
        case "bed": return pick((i) => i.name.endsWith("_bed"));
        case "door": return pick((i) => i.name.endsWith("_door") && i.name !== "iron_door");
        case "fence": return pick((i) => i.name.endsWith("_fence") && i.name !== "nether_brick_fence");
        case "fence_gate": return pick((i) => i.name.endsWith("_fence_gate"));
        case "wheat": return pick((i) => i.name === "wheat_seeds");
        default: return pick((i) => i.name === want);
    }
}

function _V_haveFor(bot, want) {
    const items = bot.inventory.items();
    const sum = (f) => items.filter(f).reduce((a, i) => a + i.count, 0);
    switch (want) {
        case "wall": return sum((i) => _V_WALL_ITEMS.includes(i.name));
        case "fill": return sum((i) => _V_FILL_ITEMS.includes(i.name));
        case "planks": return sum((i) => i.name.endsWith("_planks"));
        case "bed": return sum((i) => i.name.endsWith("_bed"));
        case "door": return sum((i) => i.name.endsWith("_door") && i.name !== "iron_door");
        case "fence": return sum((i) => i.name.endsWith("_fence") && i.name !== "nether_brick_fence");
        case "fence_gate": return sum((i) => i.name.endsWith("_fence_gate"));
        default: return _V_count(bot, want);
    }
}

function _V_woodFor(bot) {
    let best = null;
    let bestN = 0;
    for (const w of _V_WOODS) {
        const n = _V_count(bot, w + "_planks") + 4 * _V_count(bot, w + "_log");
        if (n > bestN) {
            best = w;
            bestN = n;
        }
    }
    return best || _V_bestWoodSpecies(bot);
}

function _V_obtainNameFor(bot, want) {
    switch (want) {
        case "wall": return "cobblestone";
        case "fill": return "dirt";
        case "planks": return "planks";
        case "bed": return "white_bed";
        case "door": return _V_woodFor(bot) + "_door";
        case "fence": return _V_woodFor(bot) + "_fence";
        case "fence_gate": return _V_woodFor(bot) + "_fence_gate";
        default: return want;
    }
}

// count what is still missing at this site
function _V_need(bot, bp, O) {
    const need = {};
    for (const e of bp.entries) {
        const pos = O.offset(e.p[0], e.p[1], e.p[2]);
        const b = bot.blockAt(pos);
        if (b && _V_ok(b, e.b)) continue;
        // optional extras (torches) are placed if we happen to have them; never worth a trip
        if (e.optional) continue;
        if (e.b === "farmland") {
            if (b && _V_SOIL.includes(b.name)) continue; // only needs a hoe
            need.fill = (need.fill || 0) + 1;
            continue;
        }
        if (e.b === "water") {
            need.water_bucket = 1;
            continue;
        }
        const k = e.b === "*solid" ? "fill" : e.b;
        need[k] = (need[k] || 0) + 1;
    }
    if (bp.entries.some((e) => e.b === "farmland")) need.hoe = 1;
    return need;
}

async function _V_gatherFor(bot, need) {
    for (const [k, n] of Object.entries(need)) {
        if (k === "hoe") {
            if (!bot.inventory.items().some((i) => i.name.endsWith("_hoe")) && !(await obtainItem(bot, "wooden_hoe", 1))) return false;
            continue;
        }
        if (k === "water_bucket") {
            if (!_V_has(bot, "water_bucket") && !(await collectWater(bot))) return false;
            continue;
        }
        let have = _V_haveFor(bot, k);
        if (k === "fill") have += Math.max(0, _V_haveFor(bot, "wall") - (need.wall || 0)); // spare stone fills holes too
        if (have >= n) continue;
        const name = _V_obtainNameFor(bot, k);
        bot.chat(`Gathering ${n - have} ${k === "fill" ? "dirt" : k} for building`);
        const ok = await obtainItem(bot, name, _V_count(bot, name) + (n - have));
        if (!ok && k !== "torch") {
            bot.chat(`Not enough ${k} to build`);
            return false;
        }
    }
    return true;
}

// ---- placing and digging single blocks
function _V_bodyIn(bot, pos) {
    const p = bot.entity.position;
    const r = 0.3;
    return p.x + r > pos.x && p.x - r < pos.x + 1 && p.z + r > pos.z && p.z - r < pos.z + 1 &&
        p.y + 1.8 > pos.y && p.y < pos.y + 1;
}

async function _V_stepOutOf(bot, pos, avoid) {
    if (!_V_bodyIn(bot, pos)) return;
    const f = bot.entity.position.floored();
    for (let r = 1; r <= 3; r++)
        for (let dx = -r; dx <= r; dx++)
            for (let dz = -r; dz <= r; dz++)
                for (let dy = -1; dy <= 1; dy++) {
                    if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
                    const c = f.offset(dx, dy, dz);
                    if (c.equals(pos) || (avoid && avoid.has(c.toString()))) continue;
                    const a = bot.blockAt(c);
                    const h = bot.blockAt(c.offset(0, 1, 0));
                    const g = bot.blockAt(c.offset(0, -1, 0));
                    if (a && h && g && _V_AIR.has(a.name) && _V_AIR.has(h.name) && g.boundingBox === "block") {
                        await _V_goto(bot, new GoalBlock(c.x, c.y, c.z), 10000).catch(() => {});
                        if (!_V_bodyIn(bot, pos)) return;
                    }
                }
}

async function _V_reach(bot, pos, dist = 4.2) {
    const eye = bot.entity.position.offset(0, bot.entity.height * 0.9, 0);
    if (eye.distanceTo(pos.offset(0.5, 0.5, 0.5)) <= dist) return true;
    await _V_goto(bot, new GoalNear(pos.x, pos.y, pos.z, 3), 30000).catch(() => {});
    const eye2 = bot.entity.position.offset(0, bot.entity.height * 0.9, 0);
    return eye2.distanceTo(pos.offset(0.5, 0.5, 0.5)) <= dist + 0.5;
}

async function _V_clearCell(bot, pos, keepIf) {
    const b = bot.blockAt(pos);
    if (!b || _V_AIR.has(b.name)) return true;
    if (keepIf && _V_ok(b, keepIf)) return true;
    if (b.name === "water" || b.name === "lava" || b.name === "bedrock") return false;
    await _V_reach(bot, pos);
    await _V_dig(bot, b).catch(() => {});
    await bot.waitForTicks(2);
    const a = bot.blockAt(pos);
    return !a || _V_AIR.has(a.name);
}

async function _V_till(bot, pos, stand = null) {
    let g = bot.blockAt(pos);
    if (g && g.name === "farmland") return true;
    const above = pos.offset(0, 1, 0);
    if (!(await _V_clearCell(bot, above))) return false;
    if (!g || !["dirt", "grass_block", "dirt_path", "coarse_dirt", "rooted_dirt"].includes(g.name)) {
        if (g && !_V_AIR.has(g.name) && !(await _V_clearCell(bot, pos))) return false;
        if (!(await _V_placeAt(bot, pos, "dirt"))) return false;
        g = bot.blockAt(pos);
    }
    const hoe = bot.inventory.items().find((i) => i.name.endsWith("_hoe"));
    if (!hoe) return false;
    if (stand) await _V_travel(bot, stand, 0, 15000);
    await _V_reach(bot, pos, 4.5);
    await bot.equip(hoe, "hand");
    for (let i = 0; i < 2 && bot.blockAt(pos).name !== "farmland"; i++) {
        await bot.activateBlock(bot.blockAt(pos)).catch((e) => console.log(`[till] activate error ${e.message}`));
        await bot.waitForTicks(3);
    }
    const ok = bot.blockAt(pos).name === "farmland";
    if (!ok) {
        const eye = bot.entity.position.offset(0, 1.62, 0);
        console.log(`[till] failed at ${pos}: ${bot.blockAt(pos).name}, above ${bot.blockAt(pos.offset(0, 1, 0)).name}, ` +
            `dist ${eye.distanceTo(pos.offset(0.5, 1, 0.5)).toFixed(1)}, hand ${bot.heldItem && bot.heldItem.name}`);
    }
    return ok;
}

async function _V_pourWater(bot, pos) {
    if (bot.blockAt(pos)?.name === "water") return true;
    if (!_V_has(bot, "water_bucket") && !(await collectWater(bot))) return false;
    await _V_travel(bot, pos, 3, 120000);
    if (!(await _V_clearCell(bot, pos))) return false;
    const below = bot.blockAt(pos.offset(0, -1, 0));
    if (!below || below.boundingBox !== "block") await _V_placeAt(bot, pos.offset(0, -1, 0), "*solid");
    await _V_stepOutOf(bot, pos);
    await _V_reach(bot, pos, 3.5);
    await bot.equip(bot.inventory.findInventoryItem(mcData.itemsByName.water_bucket.id), "hand");
    await bot.lookAt(pos.offset(0.5, 0.05, 0.5), true);
    bot.activateItem();
    await bot.waitForTicks(8);
    return bot.blockAt(pos)?.name === "water";
}

// place what `want` asks for at pos (absolute); returns true if the block there is right afterwards
async function _V_placeAt(bot, pos, want, opts = {}) {
    let cur = bot.blockAt(pos);
    if (cur && _V_ok(cur, want)) return true;
    if (want === "farmland") return _V_till(bot, pos, opts.stand);
    if (want === "water") return _V_pourWater(bot, pos);
    if (cur && !_V_AIR.has(cur.name) && !(await _V_clearCell(bot, pos))) return false;
    const item = _V_itemFor(bot, want);
    if (!item) return false;
    if (opts.stand) await _V_travel(bot, opts.stand, 0, 30000);
    await _V_stepOutOf(bot, pos, opts.avoid);
    if (!opts.stand || !(await _V_reach(bot, pos, 4.5))) await _V_reach(bot, pos);
    const order = [[0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]];
    const refs = opts.ref ? [opts.ref] : order.map((o) => pos.offset(o[0], o[1], o[2]));
    for (const refPos of refs) {
        const ref = bot.blockAt(refPos);
        if (!ref || ref.boundingBox !== "block" || _V_INTERACTIVE.test(ref.name)) continue;
        try {
            await bot.equip(_V_itemFor(bot, want) || item, "hand");
            await bot.placeBlock(ref, pos.minus(refPos));
        } catch (e) { /* placeBlock often throws on success; verify instead */ }
        await bot.waitForTicks(2);
        if (_V_ok(bot.blockAt(pos), want)) return true;
    }
    return _V_ok(bot.blockAt(pos), want);
}

// ---- the builder
async function _V_buildBlueprint(bot, bp, O, maxSeconds = 600) {
    _V_protectBase(bot);
    const end = Date.now() + maxSeconds * 1000;
    const abs = (p) => O.offset(p[0], p[1], p[2]);
    const box = { min: _V_plain(abs(bp.box.min)), max: _V_plain(abs(bp.box.max)) };
    const mv = bot.pathfinder.movements;
    // while building, the pathfinder may not dig or drop scaffolding inside the site
    const noPlace = (b) => (b && b.position && _V_inBox(b.position, box) ? 1000 : 0);
    const noBreak = (b) => (b && b.position && _V_inBox(b.position, box) ? 100 : 0);
    const stepBox = bp.noStep ? { min: _V_plain(abs(bp.noStep.min)), max: _V_plain(abs(bp.noStep.max)) } : null;
    const noStep = (b) => (stepBox && b && b.position && _V_inBox(b.position, stepBox) ? 100 : 0);
    mv.exclusionAreasPlace.push(noPlace);
    mv.exclusionAreasBreak.push(noBreak);
    mv.exclusionAreasStep.push(noStep);
    const stopReflexes = _V_startReflexes(bot);
    try {
        const wantAt = new Map(bp.entries.map((e) => [abs(e.p).toString(), e.b]));
        const cells = [];
        for (let y = bp.clear.max[1]; y >= bp.clear.min[1]; y--)
            for (let x = bp.clear.min[0]; x <= bp.clear.max[0]; x++)
                for (let z = bp.clear.min[2]; z <= bp.clear.max[2]; z++) cells.push(abs([x, y, z]));
        for (const c of bp.extraClear || []) cells.push(abs(c));
        bot.chat(`Clearing the ${bp.type} site at ${O.x}, ${O.y}, ${O.z}`);
        for (const c of cells) {
            if (Date.now() > end) break;
            const b = bot.blockAt(c);
            // the other halves of beds and doors, crops and gates we already made stay put
            if (b && /(_bed|_door|_fence_gate)$|^wheat$/.test(b.name)) continue;
            await _V_clearCell(bot, c, wantAt.get(c.toString()));
        }
        let pending = bp.entries.slice().sort((a, b) => a.phase - b.phase || (a.ring || 0) - (b.ring || 0) || a.p[1] - b.p[1]);
        for (let pass = 0; pass < 3 && pending.length && Date.now() < end; pass++) {
            const avoid = new Set(pending.map((e) => abs(e.p).toString()));
            const failed = [];
            for (const e of pending) {
                if (Date.now() > end) {
                    failed.push(e);
                    continue;
                }
                const pos = abs(e.p);
                const ok = await _V_placeAt(bot, pos, e.b, {
                    stand: e.stand && abs(e.stand), ref: e.ref && abs(e.ref), avoid,
                });
                if (ok) avoid.delete(pos.toString());
                else failed.push(e);
            }
            pending = failed;
            if (pending.length && pass < 2) await _V_gatherFor(bot, _V_need(bot, bp, O));
        }
        // walking (and jumping) over a field tramples farmland back to dirt: touch it up last
        for (const e of bp.entries) {
            if (e.b === "farmland" && !_V_ok(bot.blockAt(abs(e.p)), e.b) && Date.now() < end) await _V_till(bot, abs(e.p), e.stand && abs(e.stand));
        }
        const missing = bp.entries.filter((e) => !_V_ok(bot.blockAt(abs(e.p)), e.b));
        for (const e of missing.slice(0, 12)) console.log(`[build] missing ${e.b} at ${JSON.stringify(e.p)}: found ${bot.blockAt(abs(e.p))?.name}`);
        const required = missing.filter((e) => !e.optional);
        return { ok: required.length === 0, missing: missing.length, total: bp.entries.length, box };
    } finally {
        stopReflexes();
        mv.exclusionAreasPlace = mv.exclusionAreasPlace.filter((f) => f !== noPlace);
        mv.exclusionAreasBreak = mv.exclusionAreasBreak.filter((f) => f !== noBreak);
        mv.exclusionAreasStep = mv.exclusionAreasStep.filter((f) => f !== noStep);
    }
}

function _V_record(bot, bp, O, result) {
    const base = getBase(bot);
    const abs = (p) => _V_plain(O.offset(p[0], p[1], p[2]));
    base.structures = base.structures.filter((s) => !(s.type === bp.type && s.origin.x === O.x && s.origin.y === O.y && s.origin.z === O.z));
    const marks = {};
    for (const [k, v] of Object.entries(bp.marks || {})) marks[k] = Array.isArray(v[0]) ? v.map(abs) : abs(v);
    const s = { type: bp.type, origin: _V_plain(O), box: result.box, ok: result.ok, marks };
    base.structures.push(s);
    if (bp.type === "hut" || !base.home) base.home = bp.type === "hut" ? marks.outside : _V_plain(O);
    _V_saveBase(bot);
    if (result.ok) bot.save(`built:${bp.type}`);
    return s;
}

// build a blueprint near home (or here); reuses and repairs an existing one of that type
async function buildStructure(bot, type, maxSeconds = 900) {
    const base = getBase(bot);
    const bp = _V_blueprint(type);
    const existing = _V_structure(bot, type);
    let O = null;
    if (existing && type !== "storage") {
        O = _V_v(existing.origin);
    } else if (type === "storage" && _V_structure(bot, "hut")) {
        // storage goes along the east wall of the hut, if there is room
        const hut = _V_structure(bot, "hut");
        const cand = _V_v(hut.origin).offset(6, 0, 1);
        const taken = base.structures.some((s) => s.type === "storage" && s.origin.x === cand.x && s.origin.z === cand.z);
        O = taken ? null : cand;
        if (existing && taken) O = _V_v(existing.origin);
    }
    if (!O) {
        const near = base.home || null;
        for (let attempt = 0; attempt < 3 && !O; attempt++) {
            O = _V_findSite(bot, bp.w, bp.d, { near: attempt === 0 ? near : null, radius: attempt === 0 && near ? 32 : 48, margin: 1, soil: bp.soil });
            if (!O) {
                console.log(`[build] no flat ${bp.w}x${bp.d} site near ${bot.entity.position.floored()}; exploring`);
                await exploreUntil(bot, _V_randomDir(), 40, () => null);
            }
        }
    }
    if (!O) {
        bot.chat(`Couldn't find flat ground for a ${type}`);
        return false;
    }
    const todo = _V_need(bot, bp, O);
    delete todo.hoe;
    delete todo.torch;
    if (existing && !Object.keys(todo).length) {
        const s = _V_record(bot, bp, O, { ok: true, box: existing.box, total: bp.entries.length, missing: 0 });
        bot.chat(`[build] ${type} complete (already built at ${O.x}, ${O.y}, ${O.z})`);
        return true;
    }
    bot.chat(`Building a ${type} at ${O.x}, ${O.y}, ${O.z}`);
    if (!(await _V_gatherFor(bot, _V_need(bot, bp, O)))) {
        _V_record(bot, bp, O, { ok: false, box: { min: _V_plain(O.offset(...bp.box.min)), max: _V_plain(O.offset(...bp.box.max)) } });
        return false;
    }
    await _V_travel(bot, O.offset(Math.floor(bp.w / 2), 0, -2), 2, 240000);
    const result = await _V_buildBlueprint(bot, bp, O, maxSeconds);
    const s = _V_record(bot, bp, O, result);
    bot.chat(result.ok ? `[build] ${type} complete (${result.total - result.missing}/${result.total} blocks)`
        : `[build] ${type} unfinished: ${result.missing} of ${result.total} blocks missing`);
    return result.ok;
}

// ---- the things a player builds, as skills
async function buildHome(bot) {
    return buildStructure(bot, "hut");
}

async function buildStorage(bot) {
    return buildStructure(bot, "storage");
}

// buildWheatFarm(bot): fenced, watered 7x7 field near home, tilled and planted with all seeds held
async function buildWheatFarm(bot) {
    if (!_V_has(bot, "wheat_seeds", 8)) await obtainItem(bot, "wheat_seeds", 8);
    const built = await buildStructure(bot, "farm");
    const farm = _V_structure(bot, "farm");
    if (!farm) return false;
    const box = farm.box;
    const countTilled = () => {
        let n = 0;
        for (let x = box.min.x + 1; x <= box.max.x - 1; x++)
            for (let z = box.min.z + 1; z <= box.max.z - 1; z++)
                if (bot.blockAt(new Vec3(x, farm.origin.y - 1, z))?.name === "farmland") n++;
        return n;
    };
    await _V_plantFarm(bot, farm); // in through the gate: re-till trampled tiles and plant
    const tilled = countTilled();
    bot.chat(`Farm has ${tilled}/48 tilled tiles`);
    return built && tilled >= 44;
}

async function _V_plantFarm(bot, farm) {
    const box = farm.box;
    const inside = _V_insideBox(bot, box);
    if (!inside) await _V_passDoor(bot, _V_v(farm.marks.gate), _V_v(farm.marks.outside), _V_v(farm.marks.inside));
    let planted = 0;
    for (let x = box.min.x + 1; x <= box.max.x - 1; x++)
        for (let z = box.min.z + 1; z <= box.max.z - 1; z++) {
            let soil = bot.blockAt(new Vec3(x, farm.origin.y - 1, z));
            if (soil && ["dirt", "grass_block", "dirt_path", "coarse_dirt"].includes(soil.name)) {
                await _V_till(bot, soil.position); // trampled since it was tilled
                soil = bot.blockAt(soil.position);
            }
            const above = bot.blockAt(new Vec3(x, farm.origin.y, z));
            if (!soil || soil.name !== "farmland" || !above || !_V_AIR.has(above.name)) continue;
            const seeds = bot.inventory.findInventoryItem(mcData.itemsByName.wheat_seeds.id);
            if (!seeds) break;
            await _V_reach(bot, soil.position);
            await bot.equip(seeds, "hand");
            await bot.placeBlock(soil, new Vec3(0, 1, 0)).catch(() => {});
            await bot.waitForTicks(1);
            planted++;
        }
    await _V_passDoor(bot, _V_v(farm.marks.gate), _V_v(farm.marks.inside), _V_v(farm.marks.outside));
    if (planted) bot.chat(`Planted ${planted} seeds`);
    return planted;
}

// harvestFarm(bot): harvest ripe wheat at the home farm and replant
async function harvestFarm(bot) {
    const farm = _V_structure(bot, "farm");
    if (!farm) {
        bot.chat("No farm yet; build one with buildWheatFarm");
        return 0;
    }
    const before = _V_count(bot, "wheat");
    await _V_passDoor(bot, _V_v(farm.marks.gate), _V_v(farm.marks.outside), _V_v(farm.marks.inside));
    const ripe = bot.findBlocks({ matching: mcData.blocksByName.wheat.id, maxDistance: 12, count: 60 })
        .map((p) => bot.blockAt(p)).filter((b) => b && b.metadata === 7 && _V_inBox(b.position, farm.box));
    for (const c of ripe) {
        await _V_reach(bot, c.position);
        await _V_dig(bot, c).catch(() => {});
    }
    await _V_collectDrops(bot, _V_v(farm.marks.centre), 6);
    await _V_plantFarm(bot, farm); // replants and walks out
    const got = _V_count(bot, "wheat") - before;
    bot.chat(`Harvested ${got} wheat`);
    return got;
}

// ---- home life
function _V_isNight(bot) {
    const t = bot.time.timeOfDay;
    return t >= 12542 && t <= 23460;
}

async function goHome(bot) {
    const base = getBase(bot);
    if (!base.home) {
        bot.chat("I have no home yet");
        return false;
    }
    const ok = await _V_travel(bot, _V_v(base.home), 1, 240000);
    bot.chat(ok ? "I'm home" : "Couldn't get home");
    return ok;
}

// sleepAtHome(bot): walk home, go inside, sleep in the bed; stays in the hut while it's still dark
async function sleepAtHome(bot, maxSeconds = 300) {
    const hut = _V_structure(bot, "hut");
    if (!hut || !hut.marks.bed) {
        bot.chat("I have no home with a bed yet");
        return false;
    }
    if (!_V_isNight(bot) && !bot.thunderState) {
        bot.chat("It's daytime; beds only work at night");
        return false;
    }
    await equipBestGear(bot);
    if (!_V_insideBox(bot, hut.box)) {
        if (!(await _V_travel(bot, _V_v(hut.marks.outside), 0, 240000))) {
            bot.chat("Couldn't get home");
            return false;
        }
        if (_V_hostilesNear(bot, 6).length) await defendSelf(bot, 6, 20);
        await _V_passDoor(bot, _V_v(hut.marks.doorAt), _V_v(hut.marks.outside), _V_v(hut.marks.inside));
    }
    const bed = bot.blockAt(_V_v(hut.marks.bed));
    if (!bed || !bed.name.endsWith("_bed")) {
        bot.chat("My bed is missing");
        return false;
    }
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            await bot.sleep(bed);
            break;
        } catch (e) {
            if (attempt === 2) {
                bot.chat(`Can't sleep: ${e.message}`);
                return false;
            }
            await bot.waitForTicks(40);
        }
    }
    bot.chat("Sleeping at home");
    bot.save("slept");
    await Promise.race([new Promise((r) => bot.once("wake", r)), new Promise((r) => setTimeout(r, maxSeconds * 1000))]);
    if (bot.isSleeping) await bot.wake().catch(() => {});
    bot.chat(_V_isNight(bot) ? "Woke up; staying inside while it's dark" : "Good morning");
    return true;
}

// leaveHome(bot): step out of the hut through the door
async function leaveHome(bot) {
    const hut = _V_structure(bot, "hut");
    if (!hut || !_V_insideBox(bot, hut.box)) return true;
    return _V_passDoor(bot, _V_v(hut.marks.doorAt), _V_v(hut.marks.inside), _V_v(hut.marks.outside));
}

// ---- storage
var _V_JUNK = ["dirt", "gravel", "sand", "red_sand", "andesite", "diorite", "granite", "tuff", "calcite", "deepslate",
    "netherrack", "dripstone_block", "pointed_dripstone", "moss_block", "smooth_basalt", "rotten_flesh", "spider_eye", "poisonous_potato", "kelp", "seagrass", "clay_ball", "snowball",
    "dandelion", "poppy", "cornflower", "azure_bluet", "oxeye_daisy", "allium", "blue_orchid", "lily_of_the_valley"];
var _V_KEEP_MAX = { cobblestone: 32, cobbled_deepslate: 0, stick: 32, wheat_seeds: 32, bone: 8, string: 16, flint: 8 };

function _V_depositList(bot) {
    const out = [];
    const seen = {};
    for (const it of bot.inventory.items()) seen[it.name] = (seen[it.name] || 0) + it.count;
    for (const [name, n] of Object.entries(seen)) {
        let extra = 0;
        if (_V_JUNK.includes(name) || name.endsWith("_sapling") || name.endsWith("_tulip")) extra = n;
        else if (name in _V_KEEP_MAX) extra = n - _V_KEEP_MAX[name];
        else if (name.endsWith("_planks")) extra = n - 32;
        else if (name.endsWith("_log")) extra = n - 16;
        if (extra > 0) out.push([name, extra]);
    }
    return out;
}

// storeItems(bot): take junk and surplus blocks to the storage chests at home (building them if needed)
async function storeItems(bot) {
    let st = _V_structure(bot, "storage");
    if (!st || !st.ok) {
        if (!(await buildStorage(bot))) return false;
        st = _V_structure(bot, "storage");
    }
    const list = _V_depositList(bot);
    if (!list.length) {
        bot.chat("Nothing to store");
        bot.save("stored");
        return true;
    }
    await _V_travel(bot, _V_v(st.marks.stand), 1, 240000);
    let stored = 0;
    for (const c of st.marks.chests) {
        const left = _V_depositList(bot);
        if (!left.length) break;
        const block = bot.blockAt(_V_v(c));
        if (!block || block.name !== "chest") continue;
        await _V_reach(bot, block.position, 4);
        let chest;
        try {
            chest = await bot.openContainer(block);
        } catch (e) {
            continue;
        }
        for (const [name, n] of left) {
            try {
                await chest.deposit(mcData.itemsByName[name].id, null, n);
                stored += n;
            } catch (e) { /* chest full or item moved; try the next chest */ }
        }
        chest.close();
        await bot.waitForTicks(4);
    }
    bot.chat(`Stored ${stored} items at home`);
    if (stored > 0) bot.save("stored");
    return stored > 0;
}

// ---- animals
var _V_LURES = { cow: ["wheat"], sheep: ["wheat"], mooshroom: ["wheat"], goat: ["wheat"],
    pig: ["carrot", "potato", "beetroot"], chicken: ["wheat_seeds", "beetroot_seeds", "melon_seeds", "pumpkin_seeds"],
    rabbit: ["carrot", "dandelion"] };

// inside the fence ring (the gateway itself does not count)
function _V_inPen(p, box) {
    const f = p.floored();
    return f.x > box.min.x && f.x < box.max.x && f.z > box.min.z && f.z < box.max.z && f.y >= box.min.y && f.y <= box.max.y;
}

function _V_animalsIn(bot, animal, box) {
    return Object.values(bot.entities).filter((e) => e.name === animal && _V_inPen(e.position, box));
}

// buildAnimalPen(bot, animal = "cow", count = 2): fenced pen near home, then lead animals into it
// by holding their favourite food (wheat for cows/sheep, carrots for pigs, seeds for chickens)
async function buildAnimalPen(bot, animal = "cow", count = 2) {
    const ok = await buildStructure(bot, "pen");
    if (!ok) return false;
    return penAnimals(bot, animal, count);
}

async function penAnimals(bot, animal = "cow", count = 2, maxSeconds = 300) {
    const pen = _V_structure(bot, "pen");
    if (!pen) {
        bot.chat("No pen yet");
        return false;
    }
    const lures = _V_LURES[animal];
    if (!lures) throw new Error(`I don't know how to lure ${animal}`);
    let lure = lures.find((l) => _V_has(bot, l));
    if (!lure && !(await obtainItem(bot, lures[0], 4))) return false;
    lure = lures.find((l) => _V_has(bot, l));
    const end = Date.now() + maxSeconds * 1000;
    const mv = bot.pathfinder.movements;
    const sprint = mv.allowSprinting;
    mv.allowSprinting = false;
    try {
        while (_V_animalsIn(bot, animal, pen.box).length < count && Date.now() < end) {
            const target = Object.values(bot.entities)
                .filter((e) => e.name === animal && _V_isAdult(e) && !_V_inPen(e.position, pen.box))
                .sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position))[0];
            if (!target || target.position.distanceTo(bot.entity.position) > 80) {
                await exploreUntil(bot, _V_randomDir(), 30, () =>
                    Object.values(bot.entities).some((e) => e.name === animal && !_V_inPen(e.position, pen.box)) || null);
                continue;
            }
            await bot.equip(bot.inventory.findInventoryItem(mcData.itemsByName[lure].id), "hand");
            await _V_goto(bot, new GoalNear(target.position.x, target.position.y, target.position.z, 3), 40000).catch(() => {});
            // walk back slowly, waiting whenever the animal falls behind
            const outside = _V_v(pen.marks.outside);
            const legEnd = Date.now() + 90000;
            bot.pathfinder.setGoal(new GoalNear(outside.x, outside.y, outside.z, 1), true);
            while (Date.now() < legEnd && bot.entity.position.distanceTo(outside.offset(0.5, 0, 0.5)) > 1.8) {
                await bot.waitForTicks(10);
                if (!target.isValid) break;
                await bot.equip(bot.inventory.findInventoryItem(mcData.itemsByName[lure].id), "hand").catch(() => {});
                const gap = target.position.distanceTo(bot.entity.position);
                if (gap > 6) {
                    bot.pathfinder.setGoal(null);
                    await bot.lookAt(target.position.offset(0, 1, 0)).catch(() => {});
                    const waitEnd = Date.now() + 8000;
                    while (Date.now() < waitEnd && target.isValid && target.position.distanceTo(bot.entity.position) > 3.5) await bot.waitForTicks(5);
                    if (!target.isValid || target.position.distanceTo(bot.entity.position) > 9) break; // lost it
                    bot.pathfinder.setGoal(new GoalNear(outside.x, outside.y, outside.z, 1), true);
                }
            }
            bot.pathfinder.setGoal(null);
            if (!target.isValid || target.position.distanceTo(bot.entity.position) > 8) continue;
            // into the pen to the far side with the gate left open, wait until it has followed us in,
            // put the food away so it stops following, then walk out and shut the gate
            await _V_passDoor(bot, _V_v(pen.marks.gate), outside, _V_v(pen.marks.inside), true);
            await _V_walkTo(bot, _V_v(pen.marks.centre), 4000);
            const inEnd = Date.now() + 15000;
            while (Date.now() < inEnd && target.isValid && !_V_inPen(target.position, pen.box)) await bot.waitForTicks(5);
            await bot.waitForTicks(20); // let it walk right in, away from the gateway
            await bot.unequip("hand").catch(() => {});
            await _V_walkTo(bot, _V_v(pen.marks.inside), 4000);
            await _V_passDoor(bot, _V_v(pen.marks.gate), _V_v(pen.marks.inside), outside);
            console.log(`[pen] ${_V_animalsIn(bot, animal, pen.box).length} ${animal} inside`);
        }
    } finally {
        mv.allowSprinting = sprint;
        bot.pathfinder.setGoal(null);
    }
    const n = _V_animalsIn(bot, animal, pen.box).length;
    bot.chat(`${n} ${animal}${n === 1 ? "" : "s"} in the pen`);
    if (n >= count) bot.save(`penned:${animal}`);
    return n >= count;
}

// breedAnimals(bot, animal = "cow"): feed two adults in the pen so they breed
async function breedAnimals(bot, animal = "cow") {
    const pen = _V_structure(bot, "pen");
    const lures = _V_LURES[animal] || [];
    let lure = lures.find((l) => _V_has(bot, l, 2));
    if (!lure && lures.length && (await obtainItem(bot, lures[0], 2))) lure = lures[0];
    if (!lure) return false;
    const adults = Object.values(bot.entities).filter((e) => e.name === animal && _V_isAdult(e) &&
        (!pen || _V_inBox(e.position.floored(), pen.box)) && e.position.distanceTo(bot.entity.position) < 32).slice(0, 2);
    if (adults.length < 2) {
        bot.chat(`Need two adult ${animal}s to breed`);
        return false;
    }
    const inside = pen && !_V_insideBox(bot, pen.box);
    if (pen && inside) await _V_passDoor(bot, _V_v(pen.marks.gate), _V_v(pen.marks.outside), _V_v(pen.marks.inside));
    for (const a of adults) {
        await _V_goto(bot, new GoalNear(a.position.x, a.position.y, a.position.z, 2), 15000).catch(() => {});
        await bot.equip(bot.inventory.findInventoryItem(mcData.itemsByName[lure].id), "hand");
        await bot.activateEntity(a).catch(() => {});
        await bot.waitForTicks(5);
    }
    if (pen && inside) await _V_passDoor(bot, _V_v(pen.marks.gate), _V_v(pen.marks.inside), _V_v(pen.marks.outside));
    bot.chat(`Fed two ${animal}s`);
    return true;
}
