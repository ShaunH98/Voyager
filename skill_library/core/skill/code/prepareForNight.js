async function prepareForNight(bot) {
  await getFood(bot, 4);
  await obtainItem(bot, "stone_sword", 1);
  await obtainItem(bot, "torch", 8);
  await equipBestGear(bot);
}