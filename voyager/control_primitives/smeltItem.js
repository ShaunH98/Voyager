// smeltItem(bot, itemName, fuelName, count): smelt `count` of itemName in a furnace.
// fuelName may be null to pick automatically (coal, charcoal, then planks/logs).
// Uses a nearby furnace, or places one from the inventory, or crafts one (then picks it back up).
async function smeltItem(bot, itemName, fuelName = null, count = 1) {
    if (typeof itemName !== "string") throw new Error("itemName for smeltItem must be a string");
    if (typeof fuelName === "number") {
        count = fuelName;
        fuelName = null;
    }
    if (typeof count !== "number") throw new Error("count for smeltItem must be a number");
    if (itemName === "iron_ore") itemName = "raw_iron";
    if (itemName === "copper_ore") itemName = "raw_copper";
    if (itemName === "gold_ore") itemName = "raw_gold";
    const item = mcData.itemsByName[itemName];
    if (!item) throw new Error(`No item named ${itemName}`);
    count = Math.min(count, _V_count(bot, itemName));
    if (count <= 0) {
        bot.chat(`No ${itemName} to smelt in inventory`);
        _smeltItemFailCount++;
        if (_smeltItemFailCount > 10) throw new Error("smeltItem failed too many times, please check the input");
        return 0;
    }

    // fuel
    const fuelPick = () => {
        if (fuelName && _V_count(bot, fuelName) > 0) return fuelName;
        const order = ["coal", "charcoal", "coal_block", ..._V_PLANKS, ..._V_LOGS, "stick"];
        return order.find((f) => f !== itemName && _V_count(bot, f) > 0) || null;
    };
    let fuel = fuelPick();
    if (!fuel) {
        bot.chat("No fuel; getting some coal");
        if (!(await obtainItem(bot, "coal", Math.ceil(count / 8), 1))) await obtainItem(bot, "log", Math.ceil(count / 1.5), 1);
        fuel = fuelPick();
        if (!fuel) throw new Error("No fuel available for smelting");
    }

    // furnace
    let placed = null;
    let furnaceBlock = _V_nearbyBlock(bot, ["furnace"], 24);
    if (!furnaceBlock) {
        if (!_V_has(bot, "furnace") && !(await obtainItem(bot, "furnace", 1, 1))) throw new Error("No furnace and couldn't make one");
        furnaceBlock = placed = await _V_placeStation(bot, "furnace");
        if (!furnaceBlock) throw new Error("Couldn't find a spot to place the furnace");
    }
    await _V_goto(bot, new GoalLookAtBlock(furnaceBlock.position, bot.world)).catch(() => {});

    let furnace = null;
    for (let attempt = 0; attempt < 3 && !furnace; attempt++) {
        try {
            furnace = await bot.openFurnace(bot.blockAt(furnaceBlock.position));
        } catch (e) {
            if (bot.currentWindow) bot.closeWindow(bot.currentWindow);
            await bot.waitForTicks(20);
            await _V_goto(bot, new GoalLookAtBlock(furnaceBlock.position, bot.world), 10000).catch(() => {});
            if (attempt === 2) throw e;
        }
    }
    let made = 0;
    try {
        // clear anything left in the output slot
        if (furnace.outputItem()) await furnace.takeOutput().catch(() => {});
        let remaining = count;
        while (remaining > 0) {
            const batch = Math.min(remaining, 64);
            // fuel: enough for the batch
            if (!furnace.fuelItem()) {
                const fuelNeeded = Math.ceil(batch / (_V_FUEL[fuel] || 1));
                await furnace.putFuel(mcData.itemsByName[fuel].id, null, Math.min(fuelNeeded, _V_count(bot, fuel), 64));
            }
            const inputItem = furnace.inputItem();
            if (!inputItem) await furnace.putInput(item.id, null, batch);
            // wait for results: 10 s per item; poll each second
            const deadline = Date.now() + batch * 10500 + 15000;
            let lastProgress = Date.now();
            let got = 0;
            while (got < batch && Date.now() < deadline) {
                await bot.waitForTicks(20);
                const out = furnace.outputItem();
                if (out) {
                    const taken = await furnace.takeOutput().catch(() => null);
                    if (taken) {
                        got += taken.count;
                        lastProgress = Date.now();
                    }
                }
                if (!furnace.inputItem() && !furnace.outputItem() && furnace.progress === 0 && got > 0) break;
                if (!furnace.fuelItem() && furnace.fuel <= 0 && furnace.inputItem()) {
                    const f = fuelPick();
                    if (!f) break;
                    fuel = f;
                    await furnace.putFuel(mcData.itemsByName[f].id, null, Math.min(Math.ceil(furnace.inputItem().count / (_V_FUEL[f] || 1)), _V_count(bot, f)));
                }
                if (Date.now() - lastProgress > 30000) break; // nothing happening
            }
            made += got;
            remaining -= batch;
            if (got === 0) break;
        }
        // take back unsmelted input
        if (furnace.inputItem()) await furnace.takeInput().catch(() => {});
    } finally {
        furnace.close();
    }
    if (placed) await _V_pickUp(bot, placed);
    if (made > 0) bot.chat(`Smelted ${made} ${itemName}.`);
    else {
        bot.chat(`Failed to smelt ${itemName}, please check the fuel and input.`);
        _smeltItemFailCount++;
        if (_smeltItemFailCount > 10) throw new Error("smeltItem failed too many times, please check the fuel and input.");
    }
    return made;
}
