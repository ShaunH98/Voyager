// ---------------------------------------------------------------- water, fishing, farming

function _V_waterSurface(bot, maxDistance = 48) {
    return bot.findBlock({
        matching: (b) => b.name === "water",
        maxDistance,
        useExtraInfo: (b) => {
            const above = bot.blockAt(b.position.offset(0, 1, 0));
            return above && above.name === "air";
        },
    });
}

async function _V_findWater(bot) {
    let w = _V_waterSurface(bot);
    if (!w) w = await exploreUntil(bot, _V_randomDir(), 90, () => _V_waterSurface(bot, 32));
    return w;
}

// collectWater(bot): fill an empty bucket with water from the nearest water source.
async function collectWater(bot) {
    if (!_V_has(bot, "bucket")) {
        if (_V_has(bot, "water_bucket")) return true;
        if (!(await obtainItem(bot, "bucket", 1))) return false;
    }
    for (let attempt = 0; attempt < 4 && !_V_has(bot, "water_bucket"); attempt++) {
        const water = await _V_findWater(bot);
        if (!water) {
            bot.chat("No water nearby");
            return false;
        }
        // any still-water block (level 0) is a source
        const src = bot.findBlocks({ matching: mcData.blocksByName.water.id, maxDistance: 8, count: 40, point: water.position })
            .map((p) => bot.blockAt(p)).find((b) => b && b.metadata === 0 && bot.blockAt(b.position.offset(0, 1, 0))?.name === "air") || water;
        await _V_goto(bot, new GoalNear(src.position.x, src.position.y + 1, src.position.z, 2)).catch(() => {});
        await bot.equip(bot.inventory.findInventoryItem(mcData.itemsByName.bucket.id), "hand");
        await bot.lookAt(src.position.offset(0.5, 0.9, 0.5), true);
        bot.activateItem();
        await bot.waitForTicks(10);
        bot.deactivateItem();
    }
    const ok = _V_has(bot, "water_bucket");
    bot.chat(ok ? "Filled bucket with water" : "Couldn't fill the bucket");
    return ok;
}

// catchFish(bot, count = 3, maxSeconds = 240): fish with a fishing rod (crafted if needed) at nearby water.
async function catchFish(bot, count = 3, maxSeconds = 240) {
    const fish = ["cod", "salmon", "tropical_fish", "pufferfish"];
    const have = () => fish.reduce((a, n) => a + _V_count(bot, n), 0);
    const start = have();
    if (!_V_has(bot, "fishing_rod") && !(await obtainItem(bot, "fishing_rod", 1))) return false;
    // prefer a big body of water: a water block with lots of water around it
    let water = await _V_findWater(bot);
    if (!water) {
        bot.chat("No water to fish in");
        return false;
    }
    const big = bot.findBlocks({ matching: mcData.blocksByName.water.id, maxDistance: 32, count: 400 })
        .filter((p) => bot.blockAt(p.offset(0, 1, 0))?.name === "air" &&
            bot.findBlocks({ matching: mcData.blocksByName.water.id, maxDistance: 3, count: 30, point: p }).length >= 20);
    if (big.length) water = bot.blockAt(big[0]);
    await _V_goto(bot, new GoalNear(water.position.x, water.position.y + 1, water.position.z, 2)).catch(() => {});
    const end = Date.now() + maxSeconds * 1000;
    while (have() - start < count && Date.now() < end) {
        const rod = bot.inventory.findInventoryItem(mcData.itemsByName.fishing_rod.id);
        if (!rod) break;
        await bot.equip(rod, "hand");
        // cast 2-4 blocks out onto open water surface
        const me = bot.entity.position;
        const open = bot.findBlocks({ matching: mcData.blocksByName.water.id, maxDistance: 6, count: 200 })
            .filter((p) => {
                const d = Math.hypot(p.x + 0.5 - me.x, p.z + 0.5 - me.z);
                return d >= 2 && d <= 4.5 && bot.blockAt(p.offset(0, 1, 0))?.name === "air";
            });
        const spot = open.length ? open[Math.floor(Math.random() * open.length)] : water.position;
        await bot.lookAt(spot.offset(0.5, 1.2, 0.5), true);
        try {
            await Promise.race([bot.fish(), new Promise((_, rej) => setTimeout(() => rej(new Error("no bite")), 45000))]);
        } catch (e) {
            bot.activateItem(); // reel in
            await bot.waitForTicks(10);
        }
        await _V_collectDrops(bot, null, 6);
    }
    const got = have() - start;
    bot.chat(`Caught ${got} fish`);
    return got >= count;
}

// farmWheat(bot, count = 3): till dirt next to water, plant seeds, grow with bone meal if held
// (otherwise waits for growth), harvest and replant. Gets a hoe, seeds and water bucket as needed.
async function farmWheat(bot, count = 3, maxSeconds = 300) {
    const start = _V_count(bot, "wheat");
    const end = Date.now() + maxSeconds * 1000;
    if (!bot.inventory.items().some((i) => i.name.endsWith("_hoe"))) {
        if (!(await obtainItem(bot, "wooden_hoe", 1))) return false;
    }
    if (!_V_has(bot, "wheat_seeds") && !(await obtainItem(bot, "wheat_seeds", 2))) return false;

    // farmland spots: dirt/grass with air above, within 4 of water
    const findPlots = () => bot.findBlocks({
        matching: (b) => ["dirt", "grass_block", "farmland"].includes(b.name),
        maxDistance: 16, count: 200,
    }).filter((p) => {
        const above = bot.blockAt(p.offset(0, 1, 0));
        if (!above || !(above.name === "air" || above.name === "wheat")) return false;
        return bot.findBlocks({ matching: mcData.blocksByName.water.id, maxDistance: 4, count: 1, point: p }).length > 0;
    });
    let plots = findPlots();
    // no soil here (beach, desert, stone): go find grass first
    const soil = () => bot.findBlock({ matching: (b) => ["dirt", "grass_block"].includes(b.name), maxDistance: 24,
        useExtraInfo: (b) => bot.blockAt(b.position.offset(0, 1, 0))?.name === "air" });
    if (plots.length < 3 && !soil()) {
        await exploreUntil(bot, _V_randomDir(), 90, () => soil());
        plots = findPlots();
    }
    if (plots.length < 3) {
        // make our own water: place water next to some dirt
        if (_V_has(bot, "water_bucket") || (await collectWater(bot))) {
            const dirt = soil();
            if (dirt) {
                await _V_goto(bot, new GoalNear(dirt.position.x, dirt.position.y + 1, dirt.position.z, 2)).catch(() => {});
                await _V_equipBest(bot, "shovel");
                await _V_dig(bot, dirt).catch(() => {}); // a hole for the water
                await bot.equip(bot.inventory.findInventoryItem(mcData.itemsByName.water_bucket.id), "hand");
                await bot.lookAt(dirt.position.offset(0.5, 0.2, 0.5), true);
                bot.activateItem();
                await bot.waitForTicks(10);
            }
            plots = findPlots();
        }
    }
    if (plots.length < 3) {
        // no water to be had: dry farmland still holds crops, and bone meal grows them
        const s0 = soil();
        if (s0) await _V_goto(bot, new GoalNear(s0.position.x, s0.position.y + 1, s0.position.z, 2), 20000).catch(() => {});
        const dry = bot.findBlocks({ matching: (b) => ["dirt", "grass_block", "farmland"].includes(b.name), maxDistance: 8, count: 60 })
            .filter((p) => ["air", "wheat"].includes(bot.blockAt(p.offset(0, 1, 0))?.name));
        plots = plots.concat(dry.filter((p) => !plots.some((q) => q.equals(p))));
    }
    if (!plots.length) {
        bot.chat("No farmable land here");
        return false;
    }
    const seedsAvail = _V_count(bot, "wheat_seeds");
    plots = plots.slice(0, Math.max(count, Math.min(seedsAvail, 9)));
    // till + plant
    for (const p of plots) {
        if (Date.now() > end) break;
        let ground = bot.blockAt(p);
        await _V_goto(bot, new GoalNear(p.x, p.y + 1, p.z, 3)).catch(() => {});
        if (ground.name !== "farmland") {
            const hoe = bot.inventory.items().find((i) => i.name.endsWith("_hoe"));
            await bot.equip(hoe, "hand");
            await bot.activateBlock(ground).catch(() => {});
            await bot.waitForTicks(3);
            ground = bot.blockAt(p);
        }
        const crop = bot.blockAt(p.offset(0, 1, 0));
        if (ground.name === "farmland" && crop.name === "air" && _V_has(bot, "wheat_seeds")) {
            await bot.equip(bot.inventory.findInventoryItem(mcData.itemsByName.wheat_seeds.id), "hand");
            await bot.placeBlock(ground, new Vec3(0, 1, 0)).catch(() => {});
            await bot.waitForTicks(2);
        }
    }
    // grow + harvest
    while (_V_count(bot, "wheat") - start < count && Date.now() < end) {
        const crops = bot.findBlocks({ matching: mcData.blocksByName.wheat.id, maxDistance: 16, count: 40 }).map((p) => bot.blockAt(p));
        if (!crops.length) break;
        for (const c of crops) {
            if (c.metadata < 7 && _V_has(bot, "bone_meal")) {
                await _V_goto(bot, new GoalNear(c.position.x, c.position.y, c.position.z, 3)).catch(() => {});
                await bot.equip(bot.inventory.findInventoryItem(mcData.itemsByName.bone_meal.id), "hand");
                for (let i = 0; i < 4 && bot.blockAt(c.position).metadata < 7 && _V_has(bot, "bone_meal"); i++) {
                    await bot.activateBlock(bot.blockAt(c.position)).catch(() => {});
                    await bot.waitForTicks(3);
                }
            }
            const now = bot.blockAt(c.position);
            if (now && now.name === "wheat" && now.metadata === 7) {
                await _V_goto(bot, new GoalNear(c.position.x, c.position.y, c.position.z, 3)).catch(() => {});
                await _V_dig(bot, now).catch(() => {});
                await _V_collectDrops(bot, c.position, 4);
                // replant
                const soil = bot.blockAt(c.position.offset(0, -1, 0));
                if (soil?.name === "farmland" && _V_has(bot, "wheat_seeds")) {
                    await bot.equip(bot.inventory.findInventoryItem(mcData.itemsByName.wheat_seeds.id), "hand");
                    await bot.placeBlock(soil, new Vec3(0, 1, 0)).catch(() => {});
                }
            }
        }
        if (!_V_has(bot, "bone_meal")) await bot.waitForTicks(200);
    }
    const got = _V_count(bot, "wheat") - start;
    bot.chat(`Harvested ${got} wheat`);
    return got >= count;
}
