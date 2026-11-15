async function craftShield(bot) {
  await obtainItem(bot, "shield", 1);
  const s = bot.inventory.findInventoryItem(mcData.itemsByName.shield.id);
  if (s) await bot.equip(s, "off-hand");
}