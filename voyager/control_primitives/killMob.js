// killMob(bot, mobName, timeout): find the nearest `mobName` within 48 blocks, equip the best weapon,
// kill it and pick up its drops. Uses a bow if one is held and arrows are available.
// Backs off to eat if health gets low during the fight.
// kill one specific entity (used by obtainItem so it never swaps to a baby)
async function _V_killEntity(bot, entity, timeout = 60) {
    (await _V_equipBest(bot, "sword")) || (await _V_equipBest(bot, "axe"));
    try {
        await bot.pvp.attack(entity);
        await waitForMobRemoved(bot, entity, timeout);
    } catch (e) { /* ignore */ }
    await _V_collectDrops(bot, entity.position, 8);
}

async function killMob(bot, mobName, timeout = 300) {
    if (typeof mobName !== "string") throw new Error(`mobName for killMob must be a string`);
    if (typeof timeout !== "number") throw new Error(`timeout for killMob must be a number`);

    const entity = bot.nearestEntity(
        (e) => e.name === mobName && e.position.distanceTo(bot.entity.position) < 48
    );
    if (!entity) {
        bot.chat(`No ${mobName} nearby, please explore first`);
        _killMobFailCount++;
        if (_killMobFailCount > 10) {
            throw new Error(`killMob failed too many times, make sure you explore before calling killMob`);
        }
        return;
    }

    const held = bot.inventory.slots[bot.getEquipmentDestSlot("hand")];
    const ranged = ["bow", "crossbow"];
    let droppedItem;
    if (held && ranged.includes(held.name) && _V_has(bot, "arrow")) {
        bot.hawkEye.autoAttack(entity, held.name);
        droppedItem = await waitForMobShot(bot, entity, timeout);
    } else {
        (await _V_equipBest(bot, "sword")) || (await _V_equipBest(bot, "axe"));
        const shield = bot.inventory.findInventoryItem(mcData.itemsByName.shield.id);
        if (shield && !bot.inventory.slots[45]) await bot.equip(shield, "off-hand").catch(() => {});
        // retreat-and-eat guard while fighting
        const guard = setInterval(() => {
            if (bot.health <= 6 && bot.pvp.target) {
                bot.chat("Health low, backing off");
                bot.pvp.stop();
            }
        }, 500);
        try {
            await bot.pvp.attack(entity);
            droppedItem = await waitForMobRemoved(bot, entity, timeout);
        } finally {
            clearInterval(guard);
        }
        if (bot.health <= 6) {
            const p = bot.entity.position;
            const away = p.minus(entity.position).normalize().scaled(10).plus(p);
            await _V_goto(bot, new GoalNearXZ(away.x, away.z, 2)).catch(() => {});
            await eatIfHungry(bot, 20);
        }
    }
    if (droppedItem) {
        await _V_collect(bot, droppedItem, { ignoreNoPath: true }).catch(() => {});
    }
    await _V_collectDrops(bot, entity.position, 6);
    bot.save(`${mobName}_killed`);
}
