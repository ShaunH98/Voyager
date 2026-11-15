async function equipIronArmor(bot) {
  const have = (n) => bot.inventory.items().some((i) => i.name === n) || Object.values(bot.inventory.slots).some((s) => s && s.name === n);
  const missing = ["iron_helmet", "iron_chestplate", "iron_leggings", "iron_boots"].filter((n) => !have(n));
  const cost = { iron_helmet: 5, iron_chestplate: 8, iron_leggings: 7, iron_boots: 4 };
  // one mining + smelting trip for all the iron we need
  await obtainItem(bot, "iron_ingot", missing.reduce((a, n) => a + cost[n], 0));
  for (const n of missing) await obtainItem(bot, n, 1);
  await equipBestGear(bot);
}