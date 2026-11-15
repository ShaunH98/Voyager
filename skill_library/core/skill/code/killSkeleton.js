async function killSkeleton(bot) {
  await equipBestGear(bot);
  await killMob(bot, "skeleton", 120);
}