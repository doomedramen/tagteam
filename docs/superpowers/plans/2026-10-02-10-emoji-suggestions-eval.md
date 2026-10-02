# Emoji suggestions: first picks the shipped engine gets wrong

Recorded 2026-10-02 at the end of Plan 10, from `pnpm --filter @tagteam/web emoji:eval` (79 labelled titles in
`apps/web/scripts/emoji-eval-titles.json`; shipped pipeline = sign-bit shortlist of 40 + int8 re-rank over the
committed index). First pick right: 46 of 79 (58%); in the top 3: 62 of 79 (78%). The 33 titles below miss at
first pick. Format: title | accepted emoji | what the engine returned (first, then the next two).

Pattern: cleaning verbs drift to shower, bath and broom emoji ("Wash the car" gives a shower); titles that need a
verb-to-activity jump (yoga, rent, bake) miss. Ideas: extra keywords on catalogue entries, a hand-curated override
list. Re-run the evaluation after any change to the model, the catalogue or the index.

- Mop the kitchen | 🧹🧽🪣🧼 | 🧑‍🍳 cook; 🧹 broom; 🍽️ plate
- Wash dishes | 🍽🧽🧼🫧 | 🥄 spoon; 🛁 bathtub; 🧼 soap
- Wipe the counters | 🧽🧼🧻 | 🧹 broom; 🗑️ wastebasket; 🚽 toilet
- Hang out the washing | 🧺👕🧦 | 🚿 shower; 🛁 bathtub; 🛀 person taking bath
- Iron shirts | 👔👕 | 🎽 running shirt; 👔 necktie; 👕 t-shirt
- Mow the lawn | 🌱🌿🏡🚜 | 🧑‍🌾 farmer; 🧹 broom; 🪏 shovel
- Clean the litter tray | 🐈🐱🧹🗑 | 🚮 litter in bin sign; 🧹; 🚽
- Meal prep for the week | 🍱🥗🍲🍳🥘 | 🍽️; 🥄; 🥞
- Empty the dishwasher | 🍽🧼🫧 | 🚽 toilet; 🗑️; 🛀
- Clean out the fridge | 🧊🧽🧼🥫 | 🧹; 🪥; 🗑️
- Pay rent | 💸💰🏠💳🏦 | 🏪 convenience store; 🏦 bank; 🛀
- Pay the electricity bill | 💡⚡💸💳🧾 | 🔌 plug; 💳 credit card; 🈂️
- File tax return | 🧾📄📑💰🗂 | 🗄️ file cabinet; 🧾 receipt; 📁
- Go for a run | 🏃👟 | 🎽 running shirt; 🪜 ladder; 🏃 (3rd)
- Morning yoga | 🧘 | 🌅; 🌄; 🥚
- Meditate for 10 minutes | 🧘 | 😌; 🪷; 😣
- Do homework | 📚✏📝📖 | 📓 notebook; ⌛; 📋
- Wake up at 6am | ⏰🌅☀🌄 | 🕕 six o’clock; 🕡; 🛏️
- No sugar today | 🍬🍭🚫🍩🍫 | 🚭 no smoking; 🍪; 🥚
- Clean the windows | 🪟🧽🧼 | 🧹; 🪟 (2nd); 🚿
- Renew car insurance | 🚗🚙📄 | 🚔 oncoming police car; ➕; 🚘
- Wash the car | 🚗🚙🧽🫧🧼 | 🚿; 🛁; 🧼 (3rd)
- Charge the bike lights | 🚲🔋💡🔦 | 🔌; 🔦 (2nd); 🔋
- Clear the gutters | 🏠🍂🪜 | 🧹; 🧽; 🗑️
- Defrost the freezer | 🧊❄🥶 | ☃️ snowman; 🧊 (2nd); ❄️
- Bake bread | 🍞🥖🥯 | 🥪 sandwich; 🍞 (2nd); 🥖
- Feed the sourdough starter | 🍞🥖 | 🫕; 🍲; 🥙
- Clip the dog's nails | 🐕🐶✂🦮 | 🐾 paw prints; ⚒️; 🐕 (3rd)
- Clean the fish tank | 🐟🐠🐡 | 🧽; 🐡 (2nd); 🚿
- Change the cat's water | 🐈🐱💧 | 🚿; ⛲; 🚰
- Stretch | 🧘🤸 | 🪢 knot; 🕳️; 🤏
- Take the dog to the vet | 🐕🐶🏥⚕🩺 | 🐩 poodle; 🐕 (2nd); 🐕‍🦺
- Top up the bird feeder | 🐦🐤🪶 | 🔝 TOP arrow; ⛲; 👍
