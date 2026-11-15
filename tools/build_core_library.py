"""Build skill_library/core: a curated, deduplicated skill library on top of the new primitives.

It replaces the three ~50-skill libraries from the paper (120 distinct names, many near-duplicates
with hard-coded counts and 1.18-era bugs such as smelting "iron_ore"). Every skill here is a short,
readable composition of the robust primitives, so the agent can copy and extend them.

    python tools/build_core_library.py && python tools/rebuild_index.py skill_library/core
"""
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "skill_library" / "core"


def obtain(item, n=1):
    return f'await obtainItem(bot, "{item}", {n});'


# name -> (description, body). Body is the inside of `async function name(bot) { ... }`.
SKILLS = {
    # ---------------------------------------------------------------- wood & basics
    "mineWoodLog": ("Collect 3 logs of any wood type from the nearest trees, exploring to find trees if needed.",
                    'await obtainItem(bot, "log", 3);'),
    "craftSticks": ("Craft at least 4 sticks, making planks from logs (and getting logs) as needed.",
                    obtain("stick", 4)),
    "craftCraftingTable": ("Craft a crafting table from planks, getting logs first if necessary.",
                           obtain("crafting_table")),
    "craftWoodenPickaxe": ("Craft a wooden pickaxe, collecting wood and making planks, sticks and a crafting table as needed.",
                           obtain("wooden_pickaxe")),
    "craftWoodenAxe": ("Craft a wooden axe from scratch.", obtain("wooden_axe")),
    "craftWoodenSword": ("Craft a wooden sword from scratch.", obtain("wooden_sword")),
    "craftChest": ("Craft a chest (8 planks), getting wood as needed.", obtain("chest")),
    # ---------------------------------------------------------------- stone age
    "mineTenCobblestone": ("Mine 10 cobblestone, making a wooden pickaxe first if there is none.",
                           obtain("cobblestone", 10)),
    "craftStonePickaxe": ("Craft a stone pickaxe, mining cobblestone with a wooden pickaxe first if needed.",
                          obtain("stone_pickaxe")),
    "craftStoneTools": ("Craft a full set of stone tools: pickaxe, axe, sword and shovel.",
                        "\n  ".join(obtain(t) for t in ["stone_pickaxe", "stone_axe", "stone_sword", "stone_shovel"])),
    "craftStoneSword": ("Craft a stone sword.", obtain("stone_sword")),
    "craftFurnace": ("Craft a furnace from 8 cobblestone, getting a pickaxe and cobblestone if needed.",
                     obtain("furnace")),
    "mineFiveCoalOres": ("Mine at least 5 coal, getting a pickaxe first and exploring or digging down if no coal ore is visible.",
                         obtain("coal", 5)),
    "craftTorches": ("Craft at least 8 torches from coal (or charcoal) and sticks.",
                     'if (!(await obtainItem(bot, "coal", 2))) { await obtainItem(bot, "charcoal", 2); }\n  ' + obtain("torch", 8)),
    # ---------------------------------------------------------------- iron age
    "smeltRawIron": ("Get 3 iron ingots: mine iron ore (digging down if needed) with a stone pickaxe and smelt it in a furnace.",
                     obtain("iron_ingot", 3)),
    "craftIronPickaxe": ("Craft an iron pickaxe: mine and smelt 3 iron, make sticks, use or place a crafting table.",
                         obtain("iron_pickaxe")),
    "craftIronSword": ("Craft an iron sword, mining and smelting iron as needed.", obtain("iron_sword")),
    "craftIronAxe": ("Craft an iron axe, mining and smelting iron as needed.", obtain("iron_axe")),
    "craftBucket": ("Craft a bucket from 3 iron ingots.", obtain("bucket")),
    "fillBucketWithWater": ("Fill a bucket with water from the nearest water source (crafting a bucket first if needed).",
                            "await collectWater(bot);"),
    "craftShield": ("Craft a shield (6 planks + 1 iron ingot) and put it in the off-hand.",
                    obtain("shield") + '\n  const s = bot.inventory.findInventoryItem(mcData.itemsByName.shield.id);\n  if (s) await bot.equip(s, "off-hand");'),
    "smeltRawCopper": ("Get 3 copper ingots by mining copper ore and smelting it.", obtain("copper_ingot", 3)),
    "equipIronArmor": ("Make a full set of iron armour (helmet, chestplate, leggings, boots; 24 iron) and wear it.",
                       "const have = (n) => bot.inventory.items().some((i) => i.name === n) || Object.values(bot.inventory.slots).some((s) => s && s.name === n);\n"
                       "  const missing = [\"iron_helmet\", \"iron_chestplate\", \"iron_leggings\", \"iron_boots\"].filter((n) => !have(n));\n"
                       "  const cost = { iron_helmet: 5, iron_chestplate: 8, iron_leggings: 7, iron_boots: 4 };\n"
                       "  // one mining + smelting trip for all the iron we need\n"
                       "  await obtainItem(bot, \"iron_ingot\", missing.reduce((a, n) => a + cost[n], 0));\n"
                       "  for (const n of missing) await obtainItem(bot, n, 1);"
                       + "\n  await equipBestGear(bot);"),
    "craftCompass": ("Craft a compass from 4 iron ingots and 1 redstone.", obtain("compass")),
    "craftShears": ("Craft shears from 2 iron ingots.", obtain("shears")),
    "smeltGlass": ("Get 4 glass by collecting sand and smelting it.", obtain("glass", 4)),
    "mineLapisLazuli": ("Mine at least 4 lapis lazuli, digging down to around y=0 if needed.", obtain("lapis_lazuli", 4)),
    # ---------------------------------------------------------------- diamond age
    "mineDiamonds": ("Mine at least 1 diamond: get an iron pickaxe, dig down to diamond level (y around -56) and search.",
                     obtain("diamond", 1)),
    "craftDiamondPickaxe": ("Craft a diamond pickaxe (3 diamonds + 2 sticks), mining diamonds with an iron pickaxe as needed.",
                            obtain("diamond_pickaxe")),
    "craftDiamondSword": ("Craft a diamond sword.", obtain("diamond_sword")),
    "mineRedstone": ("Mine at least 4 redstone dust with an iron pickaxe.", obtain("redstone", 4)),
    # ---------------------------------------------------------------- animals, food, farming
    "craftWhiteBed": ("Craft a bed: get 3 white wool (shear or kill sheep) and 3 planks.", obtain("white_bed")),
    "cookMeat": ("Make sure we carry at least 4 cooked meat: hunt cows, pigs, sheep or chickens and cook the meat.",
                 "await getFood(bot, 4);"),
    "eatWhenHungry": ("Eat the best food in the inventory until hunger is at least 18/20.",
                      "await eatIfHungry(bot, 18);"),
    "catchThreeFish": ("Fish with a fishing rod (crafted if needed) at nearby water until 3 fish are caught.",
                       "await catchFish(bot, 3);"),
    "plantAndHarvestWheat": ("Farm wheat: till dirt next to water, plant seeds, use bone meal if held, harvest 3 wheat.",
                             "await farmWheat(bot, 3);"),
    "craftBread": ("Make 2 bread from 6 wheat, farming wheat first if needed.",
                   'if (!(await obtainItem(bot, "wheat", 6))) { await farmWheat(bot, 6); }\n  ' + obtain("bread", 2)),
    "craftFishingRod": ("Craft a fishing rod (3 sticks + 2 string from spiders).", obtain("fishing_rod")),
    "craftBow": ("Craft a bow (3 sticks + 3 string) and 16 arrows (flint, sticks, feathers).",
                 obtain("bow") + "\n  " + obtain("arrow", 16)),
    # ---------------------------------------------------------------- combat & survival
    "killOneZombie": ("Kill the nearest zombie with the best weapon, keeping armour and shield equipped.",
                      'await equipBestGear(bot);\n  await killMob(bot, "zombie", 120);'),
    "killOneSpider": ("Kill the nearest spider and collect its string.",
                      'await equipBestGear(bot);\n  await killMob(bot, "spider", 120);'),
    "killSkeleton": ("Kill the nearest skeleton: close the distance quickly with a shield up, then fight.",
                     'await equipBestGear(bot);\n  await killMob(bot, "skeleton", 120);'),
    "defendAgainstMobs": ("Fight off every hostile mob within 12 blocks, eating when hungry; backs away from creepers.",
                          "await defendSelf(bot, 12, 90);"),
    "surviveTheNight": ("Survive the night: equip gear, eat, sleep if a bed is held, otherwise fight nearby mobs, dig a sealed shelter and wait for morning.",
                        "await surviveNight(bot, 150);"),
    "prepareForNight": ("Before dark: get 4 cooked food, 8 torches, a stone sword and wear the best gear.",
                        "await getFood(bot, 4);\n  " + obtain("stone_sword") + "\n  " + obtain("torch", 8) + "\n  await equipBestGear(bot);"),
    "buildEmergencyShelter": ("Dig into the ground and seal the hole above to hide from mobs immediately.",
                              "await buildShelter(bot);"),
}


def main():
    if OUT.exists():
        shutil.rmtree(OUT)
    (OUT / "skill" / "code").mkdir(parents=True)
    (OUT / "skill" / "description").mkdir(parents=True)
    skills = {}
    for name, (desc, body) in SKILLS.items():
        code = f"async function {name}(bot) {{\n  {body}\n}}"
        description = f"async function {name}(bot) {{\n    // {desc}\n}}"
        skills[name] = {"code": code, "description": description}
        (OUT / "skill" / "code" / f"{name}.js").write_text(code, encoding="utf-8")
        (OUT / "skill" / "description" / f"{name}.txt").write_text(description, encoding="utf-8")
    (OUT / "skill" / "skills.json").write_text(json.dumps(skills, indent=2), encoding="utf-8")
    print(f"wrote {len(skills)} skills to {OUT}")


if __name__ == "__main__":
    main()
