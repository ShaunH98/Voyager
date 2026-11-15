// THE MOST USEFUL FUNCTION. Get any item by any means, from an empty inventory if necessary:
// it mines (getting the right pickaxe first, digging down for deep ores, deepslate ores included),
// smelts (furnace + fuel handled), crafts (crafting table placed and picked back up) and hunts mobs.
// Returns true on success; on failure it explains in chat what was missing.
// await obtainItem(bot, "iron_pickaxe", 1);   await obtainItem(bot, "cobblestone", 16);
// await obtainItem(bot, "log", 4);  // any wood type      await obtainItem(bot, "cooked_beef", 3);
async function obtainItem(bot, name, count = 1) {
    /* Implementation omitted. Prefer this over manual mineBlock/craftItem/smeltItem chains. */
}
