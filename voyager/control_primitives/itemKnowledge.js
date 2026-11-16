// Shared knowledge + small helpers used by the higher-level primitives (obtainItem, survival, farming).
// Names start with _V_ so they never clash with skills the agent writes.

var _V_WOODS = ["oak", "birch", "spruce", "jungle", "acacia", "dark_oak", "mangrove"];
var _V_LOGS = _V_WOODS.map((w) => w + "_log");
var _V_PLANKS = _V_WOODS.map((w) => w + "_planks");

// item -> where it comes from when mined. tool = minimum pickaxe/axe needed, y = good depth to look at
var _V_GATHER = {
    cobblestone: { blocks: ["stone", "cobblestone"], tool: "wooden_pickaxe", y: 58 },
    cobbled_deepslate: { blocks: ["deepslate", "cobbled_deepslate"], tool: "wooden_pickaxe", y: -8 },
    coal: { blocks: ["coal_ore", "deepslate_coal_ore"], tool: "wooden_pickaxe", y: 40 },
    raw_iron: { blocks: ["iron_ore", "deepslate_iron_ore"], tool: "stone_pickaxe", y: 14 },
    raw_copper: { blocks: ["copper_ore", "deepslate_copper_ore"], tool: "stone_pickaxe", y: 40 },
    raw_gold: { blocks: ["gold_ore", "deepslate_gold_ore"], tool: "iron_pickaxe", y: -18 },
    lapis_lazuli: { blocks: ["lapis_ore", "deepslate_lapis_ore"], tool: "stone_pickaxe", y: -2 },
    redstone: { blocks: ["redstone_ore", "deepslate_redstone_ore"], tool: "iron_pickaxe", y: -56 },
    diamond: { blocks: ["diamond_ore", "deepslate_diamond_ore"], tool: "iron_pickaxe", y: -56 },
    emerald: { blocks: ["emerald_ore", "deepslate_emerald_ore"], tool: "iron_pickaxe", y: 60 },
    dirt: { blocks: ["dirt", "grass_block", "coarse_dirt", "rooted_dirt"] },
    sand: { blocks: ["sand"] },
    red_sand: { blocks: ["red_sand"] },
    gravel: { blocks: ["gravel"] },
    flint: { blocks: ["gravel"], repeatable: true },
    clay_ball: { blocks: ["clay"] },
    sugar_cane: { blocks: ["sugar_cane"] },
    cactus: { blocks: ["cactus"] },
    bamboo: { blocks: ["bamboo"] },
    pumpkin: { blocks: ["pumpkin"] },
    melon_slice: { blocks: ["melon"] },
    wheat_seeds: { blocks: ["grass", "tall_grass"], repeatable: true },
    snowball: { blocks: ["snow_block", "snow"], tool: "wooden_shovel" },
    obsidian: { blocks: ["obsidian"], tool: "diamond_pickaxe" },
    calcite: { blocks: ["calcite"], tool: "wooden_pickaxe" },
    andesite: { blocks: ["andesite"], tool: "wooden_pickaxe" },
    diorite: { blocks: ["diorite"], tool: "wooden_pickaxe" },
    granite: { blocks: ["granite"], tool: "wooden_pickaxe" },
    tuff: { blocks: ["tuff"], tool: "wooden_pickaxe" },
    amethyst_shard: { blocks: ["amethyst_cluster"] },
};
for (const w of _V_WOODS) _V_GATHER[w + "_log"] = { blocks: [w + "_log"], wood: true };
for (const w of _V_WOODS) _V_GATHER[w + "_sapling"] = { blocks: [w + "_leaves"], repeatable: true };
_V_GATHER["mangrove_propagule"] = { blocks: ["mangrove_leaves"], repeatable: true };
_V_GATHER["apple"] = { blocks: ["oak_leaves", "dark_oak_leaves"], repeatable: true };
_V_GATHER["stick"] = undefined; // always craft sticks

// output -> furnace input (first one we can get is used)
var _V_SMELT = {
    iron_ingot: ["raw_iron"],
    copper_ingot: ["raw_copper"],
    gold_ingot: ["raw_gold"],
    glass: ["sand"],
    stone: ["cobblestone"],
    smooth_stone: ["stone"],
    deepslate: ["cobbled_deepslate"],
    brick: ["clay_ball"],
    green_dye: ["cactus"],
    charcoal: _V_LOGS,
    cooked_beef: ["beef"],
    cooked_porkchop: ["porkchop"],
    cooked_mutton: ["mutton"],
    cooked_chicken: ["chicken"],
    cooked_rabbit: ["rabbit"],
    cooked_cod: ["cod"],
    cooked_salmon: ["salmon"],
    baked_potato: ["potato"],
    dried_kelp: ["kelp"],
};

// item -> mobs that drop it
var _V_MOB = {
    beef: ["cow"],
    leather: ["cow"],
    porkchop: ["pig"],
    mutton: ["sheep"],
    white_wool: ["sheep"],
    chicken: ["chicken"],
    feather: ["chicken"],
    rabbit: ["rabbit"],
    rabbit_hide: ["rabbit"],
    string: ["spider", "cave_spider"],
    spider_eye: ["spider"],
    bone: ["skeleton"],
    arrow: ["skeleton"],
    rotten_flesh: ["zombie", "husk", "drowned"],
    gunpowder: ["creeper"],
    ink_sac: ["squid"],
    slime_ball: ["slime"],
    ender_pearl: ["enderman"],
};

var _V_HOSTILE = ["zombie", "husk", "drowned", "skeleton", "stray", "spider", "cave_spider", "creeper",
    "witch", "enderman", "slime", "phantom", "pillager", "vindicator", "zombie_villager", "silverfish"];

var _V_TOOL_TIERS = ["wooden", "stone", "iron", "golden", "diamond", "netherite"];
var _V_TIER_RANK = { wooden: 0, golden: 0, stone: 1, iron: 2, diamond: 3, netherite: 4 };

// how many smelts one unit of fuel gives
var _V_FUEL = { coal: 8, charcoal: 8, coal_block: 80, lava_bucket: 100, blaze_rod: 12 };
for (const p of _V_PLANKS) _V_FUEL[p] = 1.5;
for (const l of _V_LOGS) _V_FUEL[l] = 1.5;
_V_FUEL["stick"] = 0.5;

// baby animals drop nothing; ageable mobs carry an isBaby flag in metadata
function _V_isAdult(e) {
    const md = e.metadata || [];
    return !(md[16] === true || md[15] === true);
}

function _V_count(bot, name) {
    if (name === "log" || name === "logs") return _V_LOGS.reduce((a, n) => a + _V_count(bot, n), 0);
    if (name === "planks") return _V_PLANKS.reduce((a, n) => a + _V_count(bot, n), 0);
    const it = mcData.itemsByName[name];
    if (!it) return 0;
    let n = bot.inventory.count(it.id, null);
    // worn armour / offhand count as owned
    for (const s of [5, 6, 7, 8, 45]) {
        const x = bot.inventory.slots[s];
        if (x && x.name === name) n += x.count;
    }
    return n;
}

function _V_has(bot, name, n = 1) {
    return _V_count(bot, name) >= n;
}

// best pickaxe tier we hold (-1 = none)
function _V_toolRank(bot, kind = "pickaxe") {
    let best = -1;
    for (const it of bot.inventory.items()) {
        const m = it.name.match(new RegExp("^(\\w+)_" + kind + "$"));
        if (m && _V_TIER_RANK[m[1]] !== undefined) best = Math.max(best, _V_TIER_RANK[m[1]]);
    }
    return best;
}

function _V_requiredRank(tool) {
    if (!tool) return -1;
    const m = tool.match(/^(\w+)_(pickaxe|shovel|axe)$/);
    return m ? _V_TIER_RANK[m[1]] : -1;
}

function _V_nearbyBlock(bot, names, maxDistance = 32) {
    const ids = names.map((n) => mcData.blocksByName[n]?.id).filter((x) => x !== undefined);
    if (!ids.length) return null;
    return bot.findBlock({ matching: ids, maxDistance });
}

function _V_timeLeft() {
    return (_V_deadline || Infinity) - Date.now();
}

var _V_deadline = null;

// a free spot next to the bot where a block can stand (air with solid ground, not where the bot stands)
function _V_placeSpot(bot, skip = null) {
    const base = bot.entity.position.floored();
    const offsets = [];
    for (let r = 1; r <= 3; r++)
        for (let dx = -r; dx <= r; dx++)
            for (let dz = -r; dz <= r; dz++)
                for (let dy = -1; dy <= 1; dy++)
                    if (Math.max(Math.abs(dx), Math.abs(dz)) === r) offsets.push(new Vec3(dx, dy, dz));
    for (const o of offsets) {
        const p = base.plus(o);
        if (skip && skip.has(p.toString())) continue;
        // a mob standing there blocks placement
        if (Object.values(bot.entities).some((e) => e !== bot.entity && e.type === "mob" && e.position.floored().equals(p))) continue;
        const at = bot.blockAt(p);
        const below = bot.blockAt(p.offset(0, -1, 0));
        const above = bot.blockAt(p.offset(0, 1, 0));
        // never use a bed, chest, door... as the surface: right-clicking those opens or uses them.
        // snow layers, grass and flowers count as free: a placed block simply replaces them
        if (at && below && above && _V_replaceable(at) && below.boundingBox === "block" &&
            !["water", "lava"].includes(below.name) && !/(chest|_bed|_door|_fence_gate|crafting_table|furnace|barrel|_sign|trapdoor|_fence)$/.test(below.name) &&
            _V_replaceable(above)) {
            return { pos: p, ref: below };
        }
    }
    return null;
}

function _V_replaceable(b) {
    return ["air", "cave_air", "snow", "grass", "tall_grass", "fern", "large_fern", "dead_bush", "dandelion", "poppy",
        "cornflower", "azure_bluet", "oxeye_daisy", "allium", "blue_orchid", "lily_of_the_valley", "sweet_berry_bush"].includes(b.name) ||
        b.name.endsWith("_tulip");
}

// place a station (crafting_table / furnace) from inventory next to the bot; returns the block
async function _V_placeStation(bot, name) {
    const item = bot.inventory.findInventoryItem(mcData.itemsByName[name].id);
    if (!item) return null;
    const tried = new Set(); // spots that refused a block (an animal in the way, a bad surface...)
    for (let attempt = 0; attempt < 8; attempt++) {
        let spot = _V_placeSpot(bot, tried);
        if (!spot && attempt >= 1) {
            // cramped (e.g. a tunnel): dig a 1x2 alcove beside us and use that
            const f = bot.entity.position.floored();
            for (const d of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const p = f.offset(d[0], 0, d[1]);
                const below = bot.blockAt(p.offset(0, -1, 0));
                if (!below || below.boundingBox !== "block") continue;
                if ((await _V_digSafe(bot, p)) && (await _V_digSafe(bot, p.offset(0, 1, 0)))) {
                    spot = _V_placeSpot(bot, tried);
                    if (spot) break;
                }
            }
        }
        if (!spot || attempt >= 4) {
            // step aside (out of water, away from the crowd) and try again
            const p = bot.entity.position;
            await _V_goto(bot, new GoalNearXZ(p.x + (Math.random() * 10 - 5), p.z + (Math.random() * 10 - 5), 1), 15000).catch(() => {});
            if (!spot) continue;
            spot = _V_placeSpot(bot, tried);
            if (!spot) continue;
        }
        try {
            await bot.equip(item, "hand");
            await bot.lookAt(spot.pos.offset(0.5, 0.5, 0.5));
            await bot.placeBlock(spot.ref, new Vec3(0, 1, 0));
        } catch (e) {
            /* placeBlock often throws even on success; verify below */
        }
        await bot.waitForTicks(2);
        const b = bot.blockAt(spot.pos);
        if (b && b.name === name) {
            bot.save(`${name}_placed`);
            return b;
        }
        tried.add(spot.pos.toString());
    }
    return null;
}

// pick a placed station back up so it travels with us
async function _V_pickUp(bot, block) {
    try {
        if (!block) return;
        const b = bot.blockAt(block.position);
        if (!b || b.name !== block.name) return;
        await _V_collect(bot, b, { ignoreNoPath: true });
    } catch (e) {
        /* leaving it behind is fine */
    }
}

// walk to and pick up dropped items near a position
async function _V_collectDrops(bot, around, radius = 8) {
    const center = around || bot.entity.position;
    for (let i = 0; i < 6; i++) {
        const drop = bot.nearestEntity((e) => e.name === "item" && e.position.distanceTo(center) < radius);
        if (!drop) return;
        try {
            await _V_goto(bot, new GoalNear(drop.position.x, drop.position.y, drop.position.z, 0.5));
        } catch (e) {
            return;
        }
        await bot.waitForTicks(5);
    }
}

async function _V_equipBest(bot, kind) {
    // kind: "pickaxe" | "axe" | "sword" | "shovel"
    let best = null;
    let bestRank = -1;
    for (const it of bot.inventory.items()) {
        const m = it.name.match(new RegExp("^(\\w+)_" + kind + "$"));
        if (m && _V_TIER_RANK[m[1]] !== undefined && _V_TIER_RANK[m[1]] > bestRank) {
            best = it;
            bestRank = _V_TIER_RANK[m[1]];
        }
    }
    if (best) await bot.equip(best, "hand");
    return best;
}

// ---------------------------------------------------------------- time-boxed movement / mining
// pathfinder.goto and collectBlock.collect can wait forever when a goal is unreachable through
// solid rock; these wrappers stop them after `ms` and resolve instead of hanging the whole task.
function _V_timeboxed(bot, promise, ms, stop) {
    let timer;
    const timeout = new Promise((resolve) => {
        timer = setTimeout(() => {
            try { stop(); } catch (e) { /* ignore */ }
            resolve("timeout");
        }, ms);
    });
    return Promise.race([promise.catch((e) => { throw e; }), timeout]).finally(() => clearTimeout(timer));
}

async function _V_goto(bot, goal, ms = 30000) {
    const r = await _V_timeboxed(bot, bot.pathfinder.goto(goal), ms, () => bot.pathfinder.stop());
    if (r === "timeout") {
        bot.pathfinder.setGoal(null);
        throw new Error("Took too long to reach the goal");
    }
    return r;
}

async function _V_collect(bot, targets, opts = {}, ms = null) {
    const n = Array.isArray(targets) ? targets.length : 1;
    ms = ms || Math.min(240000, 30000 + n * 25000);
    const r = await _V_timeboxed(bot, bot.collectBlock.collect(targets, opts), ms, () => {
        if (bot.collectBlock.cancelTask) bot.collectBlock.cancelTask();
        bot.pathfinder.stop();
    });
    if (r === "timeout") bot.pathfinder.setGoal(null);
    return r;
}

// dig one block safely: right tool, refuse if lava/water would pour in
async function _V_digSafe(bot, pos) {
    const b = bot.blockAt(pos);
    if (!b || b.boundingBox !== "block" || b.name === "bedrock") return b?.name !== "bedrock";
    for (const o of [[0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0]]) {
        const n = bot.blockAt(pos.offset(o[0], o[1], o[2]));
        if (n && (n.name === "lava" || n.name === "water")) return false;
    }
    try {
        if (bot.tool && bot.tool.equipForBlock) await bot.tool.equipForBlock(b, {});
        await _V_timeboxed(bot, bot.dig(b, true), 15000, () => bot.stopDigging());
    } catch (e) {
        return false;
    }
    // falling gravel/sand refills the hole: dig again a few times
    for (let i = 0; i < 4; i++) {
        await bot.waitForTicks(6);
        const again = bot.blockAt(pos);
        if (!again || again.boundingBox !== "block") return true;
        if (!["gravel", "sand", "red_sand"].includes(again.name)) return true;
        await bot.dig(again, true).catch(() => {});
    }
    return true;
}

async function _V_dig(bot, block, ms = 15000) {
    if (!block) return;
    if (bot.tool && bot.tool.equipForBlock) await bot.tool.equipForBlock(block, {}).catch(() => {});
    await _V_timeboxed(bot, bot.dig(block, true), ms, () => bot.stopDigging());
}

// background safety reflex while a long primitive runs: swim up when running out of air
function _V_startReflexes(bot) {
    const timer = setInterval(() => {
        try {
            const inWater = bot.entity.isInWater || bot.blockAt(bot.entity.position.offset(0, 1.6, 0))?.name === "water";
            if (inWater && bot.oxygenLevel !== undefined && bot.oxygenLevel < 14) bot.setControlState("jump", true);
            else if (bot.getControlState("jump") && !inWater) bot.setControlState("jump", false);
        } catch (e) { /* ignore */ }
    }, 250);
    return () => {
        clearInterval(timer);
        bot.setControlState("jump", false);
    };
}
