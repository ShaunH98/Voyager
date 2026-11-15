// Survival helpers. All are safe to call any time.
// Eat the best food until hunger >= threshold: await eatIfHungry(bot, 14);
async function eatIfHungry(bot, threshold = 14) {}
// Wear best armour, hold best sword/axe, shield in off-hand: await equipBestGear(bot);
async function equipBestGear(bot) {}
// Carry at least `count` cooked food (hunts animals and cooks the meat): await getFood(bot, 4);
async function getFood(bot, count = 4) {}
// Fight all hostile mobs within radius (backs off from creepers), returns kills: await defendSelf(bot, 12, 60);
async function defendSelf(bot, radius = 12, maxSeconds = 60) {}
// Dig a sealed 1x2 hole to hide from mobs; returns the exit position: await buildShelter(bot);
async function buildShelter(bot) {}
// Get through the night: sleep if holding a bed, else fight, shelter and wait for morning: await surviveNight(bot, 600);
async function surviveNight(bot, maxSeconds = 600) {}
