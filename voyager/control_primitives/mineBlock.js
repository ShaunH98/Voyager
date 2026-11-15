// mineBlock(bot, name, count): mine `count` blocks called `name` within 32 blocks.
// Ore names also match their deepslate variant (iron_ore -> deepslate_iron_ore) and any wood "log" works.
// If none are nearby it explores for up to ~90 s before giving up. Equips the best tool automatically.
async function mineBlock(bot, name, count = 1) {
    if (typeof name !== "string") throw new Error(`name for mineBlock must be a string`);
    if (typeof count !== "number") throw new Error(`count for mineBlock must be a number`);
    if (name === "lapis_lazuli_ore") name = "lapis_ore";
    let names = [name];
    if (name === "log" || name === "wood") names = _V_LOGS;
    else if (name.endsWith("_ore") && !name.startsWith("deepslate_") && mcData.blocksByName["deepslate_" + name]) names.push("deepslate_" + name);
    else if (name === "stone") names.push("cobblestone");
    for (const n of names) if (!mcData.blocksByName[n]) throw new Error(`No block named ${n}`);
    const ids = names.map((n) => mcData.blocksByName[n].id);
    const find = () => bot.findBlocks({ matching: ids, maxDistance: 32, count: 256 });

    let blocks = find();
    if (blocks.length === 0) {
        bot.chat(`No ${name} nearby, exploring`);
        for (let i = 0; i < 2 && blocks.length === 0; i++) {
            await exploreUntil(bot, _V_randomDir(), 45, () => (find().length ? true : null));
            blocks = find();
        }
    }
    if (blocks.length === 0) {
        bot.chat(`No ${name} nearby, please explore first`);
        _mineBlockFailCount++;
        if (_mineBlockFailCount > 10) {
            throw new Error("mineBlock failed too many times, make sure you explore before calling mineBlock");
        }
        return;
    }
    blocks = blocks.filter((p) => !_V_dangerousToMine(bot, p));
    blocks.sort((a, b) => a.distanceTo(bot.entity.position) - b.distanceTo(bot.entity.position));
    const targets = blocks.map((p) => bot.blockAt(p));
    try {
        await _V_collect(bot, targets, { ignoreNoPath: true, count: count });
    } catch (e) {
        bot.chat(`Mining ${name} stopped: ${e.message}`);
    }
    bot.save(`${name}_mined`);
}
