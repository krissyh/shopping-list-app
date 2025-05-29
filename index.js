const { App } = require("@slack/bolt");

// Initialize your app with your bot token and signing secret
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});

// Sample data store (in-memory)
let shoppingList = [
  { item: "Milk", status: "Needed" },
  { item: "Eggs", status: "Purchased" },
  { item: "Bread", status: "Needed" },
];

// Generate the home tab blocks
function generateBlocks() {
  const blocks = [];

  shoppingList.forEach((item, index) => {
    blocks.push(
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${item.item}* — _${item.status}_`,
        },
        accessory: {
          type: "overflow",
          action_id: "item_overflow",
          options: [
            {
              text: {
                type: "plain_text",
                text: "Remove",
                emoji: true,
              },
              value: `${index}`,
            },
          ],
        },
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: {
              type: "plain_text",
              // Reverse colors: Purchased = green, Needed = grey
              text: item.status === "Purchased" ? "Mark as Needed" : "Mark as Purchased",
              emoji: true,
            },
            style: item.status === "Purchased" ? "primary" : undefined, // primary=green, undefined=grey
            value: `${index}`,
            action_id: "toggle_status",
            // Using an emoji for the checkmark icon
            emoji: true,
          },
        ],
      },
      {
        type: "divider",
      }
    );
  });

  if (shoppingList.length === 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: "_Your shopping list is empty!_",
      },
    });
  }

  return blocks;
}

// When user opens the app home, publish the home tab
app.event("app_home_opened", async ({ event, client }) => {
  try {
    await client.views.publish({
      user_id: event.user,
      view: {
        type: "home",
        callback_id: "home_view",
        blocks: generateBlocks(),
      },
    });
  } catch (error) {
    console.error("Error publishing home tab:", error);
  }
});

// Handle toggle status button clicks
app.action("toggle_status", async ({ ack, body, client }) => {
  await ack();

  const index = parseInt(body.actions[0].value, 10);
  if (shoppingList[index].status === "Purchased") {
    shoppingList[index].status = "Needed";
  } else {
    shoppingList[index].status = "Purchased";
  }

  try {
    await client.views.publish({
      user_id: body.user.id,
      view: {
        type: "home",
        callback_id: "home_view",
        blocks: generateBlocks(),
      },
    });
  } catch (error) {
    console.error("Error updating home tab:", error);
  }
});

// Handle overflow menu actions (Remove)
app.action("item_overflow", async ({ ack, body, client }) => {
  await ack();
  const selected = body.actions[0].selected_option;
  if (!selected) return;

  const index = parseInt(selected.value, 10);

  // Remove the item from list
  if (index >= 0 && index < shoppingList.length) {
    shoppingList.splice(index, 1);
  }

  try {
    await client.views.publish({
      user_id: body.user.id,
      view: {
        type: "home",
        callback_id: "home_view",
        blocks: generateBlocks(),
      },
    });
  } catch (error) {
    console.error("Error updating home tab after removal:", error);
  }
});

(async () => {
  // Start your app
  await app.start(process.env.PORT || 3000);
  console.log("⚡️ Slack Bolt app is running!");
})();
