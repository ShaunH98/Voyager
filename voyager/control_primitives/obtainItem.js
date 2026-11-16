// obtainItem(bot, name, count): get `count` of any item by whatever means it takes:
// mining (with the right pickaxe, digging down for deep ores), smelting, crafting (placing and
// picking back up a crafting table / furnace), or hunting mobs. Works recursively from an empty
// inventory, e.g. obtainItem(bot, "iron_pickaxe") gathers wood, makes tools, mines and smelts iron.
// Returns true on success, false (with a chat message saying what was missing) otherwise.
async function obtainItem(bot, name, count = 1, _depth = 0) {
    if (typeof name !== "string") throw new Error("name for obtainItem must be a string");
    if (typeof count !== "number" || count < 1) count = 1;
    if (name === "log" || name === "logs") name = "log";
    if (name === "wool") name = "white_wool";
    if (name === "iron_ore") name = "raw_iron";
    if (name === "copper_ore") name = "raw_copper";
    if (name === "gold_ore") name = "raw_gold";
    if (name === "lapis_lazuli_ore" || name === "lapis_ore") name = "lapis_lazuli";
    if (name !== "log" && name !== "planks" && !mcData.itemsByName[name]) throw new Error(`No item named ${name}`);
    if (_V_count(bot, name) >= count) return true;

    const top = _depth === 0;
    let stopReflexes = null;
    if (top) {
        _V_deadline = Date.now() + 15 * 60 * 1000;
        stopReflexes = _V_startReflexes(bot);
    }
    if (_depth > 14) {
        bot.chat(`obtainItem: gave up on ${name} (too many nested steps)`);
        return false;
    }
    if (_V_timeLeft() <= 0) {
        bot.chat(`obtainItem: out of time while getting ${name}`);
        return false;
    }
    try {
        const ok = await _V_obtain(bot, name, count, _depth);
        if (top) bot.chat(ok ? `Obtained ${name} x${_V_count(bot, name)}` : `Could not obtain ${count} ${name}`);
        return ok;
    } finally {
        if (top) {
            _V_deadline = null;
            stopReflexes();
        }
    }
}

async function _V_obtain(bot, name, count, depth) {
    console.log(`[obtainItem] ${"  ".repeat(depth)}${name} x${count} (have ${_V_count(bot, name)}) inv: ${bot.inventory.items().map((i) => i.name + ":" + i.count).join(",")}`);
    // generic wood
    if (name === "log") return _V_gatherWood(bot, null, count);
    if (name === "planks") {
        const species = _V_bestWoodSpecies(bot);
        return obtainItem(bot, species + "_planks", count - _V_count(bot, "planks") + _V_count(bot, species + "_planks"), depth + 1);
    }

    const gather = _V_GATHER[name];
    if (gather) {
        if (gather.wood) return _V_gatherWood(bot, name.replace("_log", ""), count);
        return _V_gatherBlocks(bot, name, count, gather, depth);
    }
    if (_V_SMELT[name]) return _V_smeltFor(bot, name, count, depth);
    if (_V_MOB[name]) return _V_hunt(bot, name, count, depth);
    return _V_craft(bot, name, count, depth);
}

// ---------------------------------------------------------------- wood
function _V_bestWoodSpecies(bot) {
    // species we hold logs of, else the nearest tree
    for (const w of _V_WOODS) if (_V_count(bot, w + "_log") > 0) return w;
    const tree = _V_nearbyBlock(bot, _V_LOGS, 48);
    if (tree) return tree.name.replace("_log", "");
    return "oak";
}

async function _V_gatherWood(bot, species, count) {
    const want = () => (species ? _V_count(bot, species + "_log") : _V_count(bot, "log"));
    const names = species ? [species + "_log"] : _V_LOGS;
    let stalls = 0;
    const ids = names.map((n) => mcData.blocksByName[n].id);
    // logs we failed to reach; skip them on later passes
    const skip = new Set();
    const reachable = () => bot.findBlocks({ matching: ids, maxDistance: 48, count: 64 })
        .filter((p) => !skip.has(p.toString()))
        .sort((a, b) => a.distanceTo(bot.entity.position) - b.distanceTo(bot.entity.position));
    while (want() < count && _V_timeLeft() > 0) {
        const before = want();
        let positions = reachable();
        if (!positions.length) {
            await exploreUntil(bot, _V_randomDir(), 60, () => (reachable().length ? true : null));
            positions = reachable();
            if (!positions.length) {
                if (++stalls >= 4) break;
                continue;
            }
        }
        await _V_equipBest(bot, "axe");
        const targets = positions.slice(0, Math.max(1, count - before)).map((p) => bot.blockAt(p));
        try {
            await _V_collect(bot, targets, { ignoreNoPath: true });
        } catch (e) {
            bot.chat(`Wood collecting hiccup: ${e.message}`);
        }
        await _V_collectDrops(bot, null, 6);
        if (want() <= before) {
            for (const t of targets) skip.add(t.position.toString());
            if (++stalls >= 4) break;
            // these trees are out of reach: head somewhere else
            if (stalls >= 2) await exploreUntil(bot, _V_randomDir(), 30, () => null);
        } else stalls = 0;
    }
    if (want() < count) bot.chat(`I need ${count - want()} more ${species ? species + "_log" : "logs"}; no reachable trees`);
    return want() >= count;
}

function _V_randomDir(axisOnly = false) {
    if (axisOnly) {
        const a = [new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)];
        return a[Math.floor(Math.random() * a.length)];
    }
    const dirs = [new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1),
        new Vec3(1, 0, 1), new Vec3(-1, 0, 1), new Vec3(1, 0, -1), new Vec3(-1, 0, -1)];
    return dirs[Math.floor(Math.random() * dirs.length)];
}

// ---------------------------------------------------------------- mining
async function _V_ensureTool(bot, tool, depth) {
    if (!tool) return true;
    const kind = tool.split("_").slice(1).join("_");
    if (_V_toolRank(bot, kind) >= _V_requiredRank(tool)) return true;
    bot.chat(`I need a ${tool} first`);
    return obtainItem(bot, tool, 1, depth + 1);
}

async function _V_gatherBlocks(bot, name, count, info, depth) {
    if (!(await _V_ensureTool(bot, info.tool, depth))) return false;
    const ids = info.blocks.map((b) => mcData.blocksByName[b]?.id).filter((x) => x !== undefined);
    let stalls = 0;
    let explored = 0;
    const skip = new Set();
    const visible = () => bot.findBlocks({ matching: ids, maxDistance: 32, count: 64 })
        .filter((p) => !skip.has(p.toString()) && !_V_dangerousToMine(bot, p))
        // deep ores far inside rock are slow to path to: only go for close ones underground
        .filter((p) => info.y === undefined || p.distanceTo(bot.entity.position) < 16);
    while (_V_count(bot, name) < count && _V_timeLeft() > 0) {
        // tools wear out on long jobs: make a new one when it breaks
        if (!(await _V_ensureTool(bot, info.tool, depth))) break;
        const before = _V_count(bot, name);
        const need = count - before;
        let positions = visible();
        if (positions.length === 0) {
            if (info.y !== undefined && bot.entity.position.y > info.y + 6) {
                bot.chat(`Digging down toward y=${info.y} to look for ${info.blocks[0]}`);
                const moved = await _V_digDownTo(bot, info.y, () => visible().length > 0);
                if (!moved) explored++;
            } else if (info.y !== undefined) {
                // underground: branch-mine a straight tunnel, watching for the ore
                await _V_tunnel(bot, _V_randomDir(true), 24, () => visible().length > 0);
                explored++;
            } else {
                await exploreUntil(bot, _V_randomDir(), 45, () => (visible().length ? true : null));
                explored++;
            }
            if (explored >= 8) break;
            continue;
        }
        positions.sort((a, b) => a.distanceTo(bot.entity.position) - b.distanceTo(bot.entity.position));
        const targets = positions.slice(0, info.repeatable ? Math.min(need * 4, 16) : need).map((p) => bot.blockAt(p));
        try {
            await _V_collect(bot, targets, { ignoreNoPath: true });
        } catch (e) {
            bot.chat(`Mining hiccup: ${e.message}`);
        }
        await _V_collectDrops(bot, null, 6);
        for (const t of targets) {
            const now = bot.blockAt(t.position);
            if (now && now.name === t.name) skip.add(t.position.toString()); // couldn't reach it
        }
        if (_V_count(bot, name) <= before) stalls++;
        else stalls = 0;
        if (stalls >= 5) break;
    }
    const ok = _V_count(bot, name) >= count;
    if (!ok) bot.chat(`I could only get ${_V_count(bot, name)}/${count} ${name}`);
    else bot.save(`${info.blocks[0]}_mined`);
    return ok;
}

function _V_dangerousToMine(bot, p) {
    for (const o of [[0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]]) {
        const b = bot.blockAt(p.offset(o[0], o[1], o[2]));
        if (b && (b.name === "lava" || b.name === "water")) return true;
    }
    return false;
}

// Dig a staircase down toward `targetY`, one step at a time. Before each step it checks the
// blocks it would open for lava/water and turns if needed, patches holes in the floor, and stops
// early as soon as `stopFn()` is true (e.g. the ore we want is in range). Returns true if it moved.
async function _V_digDownTo(bot, targetY, stopFn = () => false) {
    const startY = bot.entity.position.y;
    let dir = _V_randomDir(true);
    let turns = 0;
    for (let i = 0; i < 200 && bot.entity.position.y > targetY + 1 && _V_timeLeft() > 0; i++) {
        if (stopFn()) break;
        const ok = await _V_step(bot, dir, -1);
        if (!ok) {
            dir = _V_randomDir(true);
            turns++;
            if (turns % 4 === 0) {
                // probably water or lava all around: walk somewhere else and start again
                if (turns > 16) {
                    bot.chat("Can't dig further down here");
                    break;
                }
                await exploreUntil(bot, _V_randomDir(), 12, () => null);
            }
        } else turns = 0;
        if (bot.food < 10) await eatIfHungry(bot, 16);
    }
    return bot.entity.position.y < startY - 2;
}

// straight 2-high tunnel `length` blocks long in `dir`, stopping early when stopFn() is true
async function _V_tunnel(bot, dir, length = 24, stopFn = () => false) {
    let moved = 0;
    for (let i = 0; i < length && _V_timeLeft() > 0; i++) {
        if (stopFn()) break;
        if (!(await _V_step(bot, dir, 0))) {
            dir = _V_randomDir(true);
            continue;
        }
        moved++;
        if (bot.food < 10) await eatIfHungry(bot, 16);
    }
    return moved;
}

// one step forward (dy = 0) or forward-and-down (dy = -1), digging what is in the way
async function _V_step(bot, dir, dy) {
    const feet = bot.entity.position.floored();
    const next = feet.offset(dir.x, dy, dir.z);
    // blocks to clear: next feet + next head, plus the block above next head when stepping down
    const clear = [next, next.offset(0, 1, 0)];
    if (dy < 0) clear.push(next.offset(0, 2, 0));
    for (const c of clear) {
        const b = bot.blockAt(c);
        if (!b) return false;
        if (b.name === "lava" || b.name === "water") return false;
        if (b.boundingBox === "block" && !(await _V_digSafe(bot, c))) return false;
    }
    // floor under the next spot
    const floor = bot.blockAt(next.offset(0, -1, 0));
    if (!floor) return false;
    if (floor.name === "lava" || floor.name === "water") return false;
    if (floor.boundingBox !== "block") {
        const below2 = bot.blockAt(next.offset(0, -2, 0));
        if (below2 && (below2.name === "lava" || below2.name === "water")) return false;
        // patch the hole if we can, otherwise refuse to step into a drop
        const fill = ["cobblestone", "cobbled_deepslate", "dirt", "andesite", "diorite", "granite", "tuff", "netherrack"].find((n) => _V_has(bot, n));
        if (!fill) return false;
        try {
            await bot.equip(bot.inventory.findInventoryItem(mcData.itemsByName[fill].id), "hand");
            const ref = bot.blockAt(next.offset(0, -2, 0));
            if (ref && ref.boundingBox === "block") await bot.placeBlock(ref, new Vec3(0, 1, 0));
            else return false;
        } catch (e) {
            return false;
        }
    }
    try {
        await _V_goto(bot, new GoalBlock(next.x, next.y, next.z), 6000);
    } catch (e) {
        return false;
    }
    return true;
}

// ---------------------------------------------------------------- smelting
async function _V_smeltFor(bot, name, count, depth) {
    const need = count - _V_count(bot, name);
    const inputs = _V_SMELT[name];
    let input = inputs.find((i) => _V_count(bot, i) > 0) || inputs[0];
    if (name === "charcoal") input = _V_LOGS.find((l) => _V_count(bot, l) > 0) || null;
    if (!input) {
        if (!(await obtainItem(bot, "log", need, depth + 1))) return false;
        input = _V_LOGS.find((l) => _V_count(bot, l) > 0);
    }
    const haveIn = _V_count(bot, input);
    if (haveIn < need && !(await obtainItem(bot, input, need, depth + 1))) return false;
    await smeltItem(bot, input, null, need);
    return _V_count(bot, name) >= count;
}

// ---------------------------------------------------------------- hunting
async function _V_hunt(bot, name, count, depth) {
    const mobs = _V_MOB[name];
    // wool: shear if we have shears
    let stalls = 0;
    let heading = _V_randomDir();
    while (_V_count(bot, name) < count && _V_timeLeft() > 0) {
        const before = _V_count(bot, name);
        let target = bot.nearestEntity((e) => mobs.includes(e.name) && _V_isAdult(e) && e.position.distanceTo(bot.entity.position) < 48);
        if (!target) {
            if (stalls === 2) heading = _V_randomDir(); // try a different way once
            target = await exploreUntil(bot, heading, 75, () =>
                bot.nearestEntity((e) => mobs.includes(e.name) && _V_isAdult(e) && e.position.distanceTo(bot.entity.position) < 32));
            if (!target) {
                if (++stalls >= 5) break;
                continue;
            }
        }
        if (name === "white_wool" && _V_has(bot, "shears") && target.name === "sheep" && !target.metadata?.[17]) {
            try {
                await _V_goto(bot, new GoalFollow(target, 2));
                await bot.equip(bot.inventory.findInventoryItem(mcData.itemsByName.shears.id), "hand");
                await bot.activateEntity(target);
                await bot.waitForTicks(10);
                await _V_collectDrops(bot, target.position, 6);
            } catch (e) { /* fall through to killing */ }
        }
        if (_V_count(bot, name) <= before) {
            await _V_killEntity(bot, target, 60);
            await _V_collectDrops(bot, null, 8);
        }
        if (_V_count(bot, name) <= before) stalls++;
        else stalls = 0;
        if (stalls >= 4) break;
    }
    return _V_count(bot, name) >= count;
}

// ---------------------------------------------------------------- crafting
function _V_ingredients(recipe) {
    const need = {};
    for (const d of recipe.delta) {
        if (d.count < 0) {
            const n = mcData.items[d.id].name;
            need[n] = (need[n] || 0) - d.count;
        }
    }
    return need;
}

function _V_estCost(bot, item, n) {
    const have = _V_count(bot, item);
    if (have >= n) return 0;
    const missing = n - have;
    if (_V_LOGS.includes(item)) return missing * (_V_nearbyBlock(bot, [item], 32) ? 1 : 4);
    if (_V_PLANKS.includes(item)) {
        const log = item.replace("_planks", "_log");
        if (_V_count(bot, log) * 4 >= missing) return missing * 0.3;
        return missing * (_V_nearbyBlock(bot, [log], 32) ? 0.6 : 2);
    }
    if (_V_GATHER[item]) return missing * 2 + (_V_GATHER[item].tool ? 2 : 0);
    if (_V_SMELT[item]) return missing * 4;
    if (_V_MOB[item]) return missing * 8;
    if (mcData.recipes[mcData.itemsByName[item]?.id]) return missing * 6;
    return 1e6; // we have no way to get it
}

async function _V_craft(bot, name, count, depth) {
    const item = mcData.itemsByName[name];
    const all = bot.recipesAll(item.id, null, true);
    if (!all.length) {
        bot.chat(`I don't know how to get ${name} (not minable, smeltable, craftable or a mob drop)`);
        return false;
    }
    for (let round = 0; round < 3 && _V_count(bot, name) < count; round++) {
        const missingOut = count - _V_count(bot, name);
        // choose the cheapest recipe given inventory and surroundings
        let best = null;
        let bestCost = Infinity;
        for (const r of all) {
            const times = Math.ceil(missingOut / r.result.count);
            let cost = 0;
            for (const [ing, n] of Object.entries(_V_ingredients(r))) cost += _V_estCost(bot, ing, n * times);
            if (cost < bestCost) {
                bestCost = cost;
                best = r;
            }
        }
        if (!best || bestCost >= 1e6) {
            bot.chat(`No usable recipe for ${name}`);
            return false;
        }
        const times = Math.ceil(missingOut / best.result.count);
        const needs = _V_ingredients(best);
        for (const [ing, n] of Object.entries(needs)) {
            if (!(await obtainItem(bot, ing, n * times, depth + 1))) {
                bot.chat(`I cannot make ${name} because I need: ${n * times - _V_count(bot, ing)} more ${ing}`);
                return false;
            }
        }
        // ingredients may have been used up by sibling steps; check again
        if (Object.entries(needs).some(([ing, n]) => _V_count(bot, ing) < n * times)) continue;

        let table = null;
        let placed = null;
        if (best.requiresTable) {
            table = _V_nearbyBlock(bot, ["crafting_table"], 16);
            if (!table) {
                if (!_V_has(bot, "crafting_table") && !(await obtainItem(bot, "crafting_table", 1, depth + 1))) return false;
                table = placed = await _V_placeStation(bot, "crafting_table");
                if (!table) {
                    bot.chat("Couldn't find a spot to place the crafting table");
                    return false;
                }
            }
            await _V_goto(bot, new GoalNear(table.position.x, table.position.y, table.position.z, 2)).catch(() => {});
        }
        await _V_doCraft(bot, item, count, table);
        if (placed) await _V_pickUp(bot, placed);
    }
    return _V_count(bot, name) >= count;
}

// craft until we hold `count` of item; settles the inventory after each craft and retries one at a
// time when the server is slow to confirm (mineflayer's "updateSlot did not fire" timeouts)
async function _V_doCraft(bot, item, count, table) {
    bot.pathfinder.setGoal(null);
    if (bot.currentWindow) bot.closeWindow(bot.currentWindow);
    // mineflayer's multi-craft often breaks after the first item ("missing ingredient") because it
    // reads the inventory before the server has updated it: after one hiccup, craft one at a time and
    // keep going as long as each craft makes progress
    let fails = 0;
    let batch = true;
    while (_V_count(bot, item.name) < count && fails < 4) {
        const recipe = bot.recipesFor(item.id, null, 1, table)[0];
        if (!recipe) break;
        const before = _V_count(bot, item.name);
        const times = batch ? Math.ceil((count - before) / recipe.result.count) : 1;
        try {
            await bot.craft(recipe, times, table);
        } catch (e) {
            batch = false;
            if (bot.currentWindow) bot.closeWindow(bot.currentWindow);
            await bot.waitForTicks(6);
            if (_V_count(bot, item.name) <= before && ++fails >= 4) bot.chat(`Crafting ${item.name} failed: ${e.message}`);
        }
        await bot.waitForTicks(4); // let the inventory catch up before counting
    }
}
