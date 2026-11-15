// craftItem(bot, name, count): do the recipe for `name` `count` times with what is in the inventory.
// Uses a nearby crafting table, or places one from the inventory (and picks it back up afterwards).
// Missing ingredients are reported in chat; use obtainItem to fetch everything automatically.
async function craftItem(bot, name, count = 1) {
    if (typeof name !== "string") throw new Error("name for craftItem must be a string");
    if (typeof count !== "number") throw new Error("count for craftItem must be a number");
    const itemByName = mcData.itemsByName[name];
    if (!itemByName) throw new Error(`No item named ${name}`);

    let craftingTable = _V_nearbyBlock(bot, ["crafting_table"], 32);
    let placed = null;
    const handRecipe = bot.recipesFor(itemByName.id, null, 1, null)[0];
    if (!craftingTable && !handRecipe && _V_has(bot, "crafting_table")) {
        craftingTable = placed = await _V_placeStation(bot, "crafting_table");
    }
    if (craftingTable) {
        await _V_goto(bot, new GoalLookAtBlock(craftingTable.position, bot.world)).catch(() => {});
    }
    const recipe = bot.recipesFor(itemByName.id, null, 1, craftingTable)[0];
    if (recipe) {
        bot.chat(`I can make ${name}`);
        try {
            await bot.craft(recipe, count, craftingTable);
            bot.chat(`I did the recipe for ${name} ${count} times`);
        } catch (err) {
            // fall back to as many times as we can
            let done = 0;
            for (let i = 0; i < count; i++) {
                const r = bot.recipesFor(itemByName.id, null, 1, craftingTable)[0];
                if (!r) break;
                try {
                    await bot.craft(r, 1, craftingTable);
                    done++;
                } catch (e) {
                    break;
                }
            }
            bot.chat(done ? `I did the recipe for ${name} ${done} times` : `I cannot do the recipe for ${name} ${count} times`);
        }
    } else {
        failedCraftFeedback(bot, name, itemByName, craftingTable);
        _craftItemFailCount++;
        if (_craftItemFailCount > 10) {
            throw new Error("craftItem failed too many times, check chat log to see what happened");
        }
    }
    if (placed) await _V_pickUp(bot, placed);
}
