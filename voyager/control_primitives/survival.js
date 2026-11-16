// ---------------------------------------------------------------- survival & combat primitives

// eatIfHungry(bot, threshold = 14): eat the best food in the inventory until hunger >= threshold.
// Avoids rotten flesh / spider eyes / pufferfish unless starving. Returns true if anything was eaten.
async function eatIfHungry(bot, threshold = 14) {
    const bad = ["rotten_flesh", "spider_eye", "pufferfish", "poisonous_potato", "suspicious_stew", "chorus_fruit"];
    let ate = false;
    for (let i = 0; i < 8 && bot.food < threshold; i++) {
        const foods = bot.inventory.items()
            .filter((it) => mcData.foodsByName[it.name])
            .filter((it) => !bad.includes(it.name) || bot.food <= 4)
            .sort((a, b) => mcData.foodsByName[b.name].foodPoints - mcData.foodsByName[a.name].foodPoints);
        if (!foods.length) {
            if (!ate) bot.chat("I'm hungry but have no food");
            break;
        }
        try {
            await bot.equip(foods[0], "hand");
            await bot.consume();
            ate = true;
        } catch (e) {
            break;
        }
    }
    if (ate) bot.chat(`Ate; hunger is now ${bot.food}/20`);
    return ate;
}

// equipBestGear(bot): wear the best armour held, hold the best sword (or axe), shield in off-hand.
async function equipBestGear(bot) {
    const rank = { leather: 0, golden: 1, chainmail: 2, iron: 3, diamond: 4, netherite: 5, turtle: 2 };
    const slots = { helmet: "head", chestplate: "torso", leggings: "legs", boots: "feet" };
    for (const [piece, dest] of Object.entries(slots)) {
        let best = null;
        for (const it of bot.inventory.items()) {
            const m = it.name.match(new RegExp("^(\\w+)_" + piece + "$"));
            if (m && rank[m[1]] !== undefined && (!best || rank[m[1]] > rank[best.name.split("_")[0]])) best = it;
        }
        if (best) await bot.equip(best, dest).catch(() => {});
    }
    const shield = bot.inventory.findInventoryItem(mcData.itemsByName.shield.id);
    if (shield) await bot.equip(shield, "off-hand").catch(() => {});
    (await _V_equipBest(bot, "sword")) || (await _V_equipBest(bot, "axe"));
    bot.chat("Equipped my best gear");
}

// getFood(bot, count = 4): make sure we carry `count` cooked food: hunt nearby animals for raw meat
// and cook it (furnace placed/crafted as needed). Falls back to raw meat if cooking is impossible.
async function getFood(bot, count = 4) {
    const cooked = ["cooked_beef", "cooked_porkchop", "cooked_mutton", "cooked_chicken", "cooked_rabbit", "cooked_cod", "cooked_salmon", "bread", "baked_potato"];
    const have = () => cooked.reduce((a, n) => a + _V_count(bot, n), 0);
    if (have() >= count) return true;
    const pairs = [["beef", "cow"], ["porkchop", "pig"], ["mutton", "sheep"], ["chicken", "chicken"], ["rabbit", "rabbit"]];
    const deadline = Date.now() + 6 * 60 * 1000;
    while (have() < count && Date.now() < deadline) {
        // raw meat already held?
        const raw = pairs.find(([meat]) => _V_count(bot, meat) > 0);
        if (raw) {
            try {
                await smeltItem(bot, raw[0], null, Math.min(_V_count(bot, raw[0]), count - have() + 1));
            } catch (e) {
                bot.chat(`Couldn't cook ${raw[0]}: ${e.message}`);
                break;
            }
            continue;
        }
        let animal = bot.nearestEntity((e) => pairs.some((p) => p[1] === e.name) && e.position.distanceTo(bot.entity.position) < 48);
        if (!animal) {
            animal = await exploreUntil(bot, _V_randomDir(), 60, () =>
                bot.nearestEntity((e) => pairs.some((p) => p[1] === e.name) && e.position.distanceTo(bot.entity.position) < 32));
            if (!animal) continue;
        }
        await killMob(bot, animal.name, 60);
    }
    const raws = pairs.reduce((a, [m]) => a + _V_count(bot, m), 0);
    bot.chat(`I have ${have()} cooked food${raws ? ` and ${raws} raw meat` : ""}`);
    return have() >= count;
}

function _V_hostilesNear(bot, radius = 16) {
    return Object.values(bot.entities).filter((e) => _V_HOSTILE.includes(e.name) && e.position.distanceTo(bot.entity.position) < radius);
}

// defendSelf(bot, radius = 12, maxSeconds = 60): fight every hostile mob within `radius` (nearest first)
// with the best gear, keeping fed. Creepers are hit then backed away from. Returns number killed.
async function defendSelf(bot, radius = 12, maxSeconds = 60) {
    const end = Date.now() + maxSeconds * 1000;
    let kills = 0;
    await equipBestGear(bot);
    while (Date.now() < end) {
        const foes = _V_hostilesNear(bot, radius).sort((a, b) =>
            a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position));
        if (!foes.length) break;
        const foe = foes[0];
        if (bot.food < 14) await eatIfHungry(bot, 18);
        if (foe.name === "creeper") {
            // hit once, then step back out of blast range
            try {
                await _V_goto(bot, new GoalFollow(foe, 2.5));
                await bot.attack(foe);
            } catch (e) { /* ignore */ }
            const p = bot.entity.position;
            const away = p.minus(foe.position).normalize().scaled(6).plus(p);
            await _V_goto(bot, new GoalNearXZ(away.x, away.z, 1)).catch(() => {});
            if (!bot.entities[foe.id]) kills++;
            continue;
        }
        const before = Object.keys(bot.entities).length;
        try {
            await killMob(bot, foe.name, Math.max(5, Math.min(40, (end - Date.now()) / 1000)));
        } catch (e) {
            bot.chat(`Fight with ${foe.name} broke off: ${e.message}`);
            // a mob we can't reach (e.g. underwater): just move away from it
            const p = bot.entity.position;
            const away = p.minus(foe.position).normalize().scaled(8).plus(p);
            await _V_goto(bot, new GoalNearXZ(away.x, away.z, 2), 8000).catch(() => {});
            if (Date.now() > end - 5000) break;
        }
        if (!bot.entities[foe.id]) kills++;
    }
    if (kills) bot.chat(`Defended myself, ${kills} mobs down`);
    return kills;
}

// buildShelter(bot): dig a 1x2 pocket straight down and seal the opening, safe from mobs.
// Returns the position to climb back out to. Avoids digging into caves, water or lava.
async function buildShelter(bot) {
    const blockNames = ["cobblestone", "cobbled_deepslate", "dirt", ..._V_PLANKS, "stone", "andesite", "diorite", "granite", "netherrack"];
    let fill = blockNames.find((n) => _V_has(bot, n));
    if (!fill) {
        await obtainItem(bot, "dirt", 4);
        fill = blockNames.find((n) => _V_has(bot, n));
    }
    const origin = bot.entity.position.floored();
    const safeBelow = (p) => {
        for (let dy = 1; dy <= 4; dy++) {
            const b = bot.blockAt(p.offset(0, -dy, 0));
            if (!b || b.boundingBox !== "block" || ["lava", "water"].includes(b.name)) return false;
        }
        return true;
    };
    if (!safeBelow(origin)) {
        // try a nearby spot
        const spot = bot.findBlocks({ matching: (b) => b.boundingBox === "block", maxDistance: 6, count: 60 })
            .map((p) => p.offset(0, 1, 0))
            .find((p) => bot.blockAt(p)?.name === "air" && bot.blockAt(p.offset(0, 1, 0))?.name === "air" && safeBelow(p));
        if (!spot) {
            if ((buildShelter._tries = (buildShelter._tries || 0) + 1) > 3) {
                buildShelter._tries = 0;
                bot.chat("No safe ground to dig a shelter here");
                return null;
            }
            await exploreUntil(bot, _V_randomDir(), 15, () => null);
            return buildShelter(bot);
        }
        await _V_goto(bot, new GoalBlock(spot.x, spot.y, spot.z)).catch(() => {});
    }
    const top = bot.entity.position.floored();
    await _V_equipBest(bot, "pickaxe");
    for (let i = 1; i <= 3; i++) {
        const b = bot.blockAt(top.offset(0, -i, 0));
        if (b && b.boundingBox === "block") {
            await _V_dig(bot, b).catch(() => {});
            await bot.waitForTicks(8);
        }
    }
    // now standing three blocks lower: seal the old ground block above our head,
    // using the surrounding ground as the block to place against
    const holeTop = top.offset(0, -1, 0);
    if (fill) {
        const item = bot.inventory.findInventoryItem(mcData.itemsByName[fill].id);
        try {
            await bot.equip(item, "hand");
            // place against a wall block next to the opening
            for (const o of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]]) {
                const wall = bot.blockAt(holeTop.offset(o[0], o[1], o[2]));
                if (wall && wall.boundingBox === "block") {
                    await bot.placeBlock(wall, new Vec3(-o[0], -o[1], -o[2])).catch(() => {});
                    break;
                }
            }
        } catch (e) { /* ignore */ }
    }
    await bot.waitForTicks(4);
    const sealed = bot.blockAt(holeTop)?.boundingBox === "block";
    buildShelter._tries = 0;
    bot.chat(sealed ? "Shelter built" : "Shelter dug but not sealed");
    return holeTop;
}

// surviveNight(bot, maxSeconds = 600): get through the night (or until maxSeconds pass):
// fight off nearby mobs, then dig a sealed shelter and wait, eating as needed; climb out at day.
async function surviveNight(bot, maxSeconds = 600) {
    const stopReflexes = _V_startReflexes(bot);
    try {
        return await _V_surviveNight(bot, maxSeconds);
    } finally {
        stopReflexes();
    }
}

async function _V_surviveNight(bot, maxSeconds) {
    const isNight = () => {
        const t = bot.time.timeOfDay;
        return t >= 12542 && t <= 23460;
    };
    if (!isNight()) {
        bot.chat("It's daytime, no need to hide");
        return true;
    }
    await equipBestGear(bot);
    await eatIfHungry(bot, 16);
    if (_V_hostilesNear(bot, 8).length) await defendSelf(bot, 8, 30);
    // home is best: a real bed behind a door
    const hut = _V_structure(bot, "hut");
    if (hut && hut.ok && _V_v(hut.origin).distanceTo(bot.entity.position) < 96) {
        if (await sleepAtHome(bot, maxSeconds).catch(() => false)) return true;
    }
    // sleep if we have a bed and it's safe
    const bed = bot.inventory.items().find((it) => it.name.endsWith("_bed"));
    if (bed) {
        const placedBed = await _V_placeStation(bot, bed.name);
        if (placedBed) {
            try {
                await bot.sleep(placedBed);
                await Promise.race([new Promise((r) => bot.once("wake", r)), new Promise((r) => setTimeout(r, maxSeconds * 1000))]);
                if (bot.isSleeping) await bot.wake().catch(() => {});
                await _V_pickUp(bot, placedBed);
                bot.chat("Slept through the night");
                return true;
            } catch (e) {
                bot.chat(`Can't sleep: ${e.message}`);
                await _V_pickUp(bot, placedBed);
            }
        }
    }
    const exit = await buildShelter(bot);
    const end = Date.now() + maxSeconds * 1000;
    // inside the shelter: never walk out to fight; only swing back if something is hurting us
    let lastHealth = bot.health;
    await _V_equipBest(bot, "sword");
    while (isNight() && Date.now() < end && bot.health > 0) {
        await bot.waitForTicks(20);
        if (bot.food < 14) await eatIfHungry(bot, 18);
        if (bot.health < lastHealth || !exit) {
            const foe = _V_hostilesNear(bot, 3.5)[0];
            if (foe) {
                await _V_equipBest(bot, "sword");
                await bot.lookAt(foe.position.offset(0, foe.height * 0.8, 0), true).catch(() => {});
                bot.attack(foe);
            }
        }
        lastHealth = bot.health;
    }
    if (exit) {
        // climb out
        const above = bot.blockAt(exit);
        if (above && above.boundingBox === "block") await _V_dig(bot, above).catch(() => {});
        await _V_goto(bot, new GoalNear(exit.x, exit.y, exit.z, 1)).catch(() => {});
    }
    bot.chat(bot.health > 0 ? "Made it through the night" : "I died during the night");
    return bot.health > 0;
}
