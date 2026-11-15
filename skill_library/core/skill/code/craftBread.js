async function craftBread(bot) {
  if (!(await obtainItem(bot, "wheat", 6))) { await farmWheat(bot, 6); }
  await obtainItem(bot, "bread", 2);
}