const { App } = require("@slack/bolt");

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});

let shoppingList = [];

// Helper to format date nicely
function formatDate(date) {
  return new Date(date).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// Generate blocks for the Home tab
function generateBlocks() {
  const blocks = [
    {
      type: "header",
      text: { type: "plain_text", text: "🛒 Shopping List" },
    },
  ];

  if (shoppingList.length === 0) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "The shopping list is empty." },
    });
  } else {
    shoppingList.forEach((item, index) => {
      const updatedText =
        item.updatedAt && item.updatedBy
          ? `(updated ${formatDate(item.updatedAt)} by ${item.updatedBy})`
          : "";

      // Status emoji just for visual
      const statusEmoji =
        item.status === "Purchased" ? ":white_check_mark:" : ":white_large_square:";

      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `${statusEmoji} *${item.name}*${item.link ? ` <${item.link}|Link>` : ""}\nStatus: *${item.status}* ${updatedText}`,
        },
      });

      blocks.push({
        type: "actions",
        block_id: `actions_${index}`,
        elements: [
          {
            type: "button",
            text: {
              type: "plain_text",
              text: item.status === "Purchased" ? "Mark as Needed" : "Mark as Purchased",
            },
            // Reversed colors: Purchased button is green, Needed is grey
            style: item.status === "Purchased" ? "primary" : "default",
            value: `${index}`,
            action_id: "toggle_status",
          },
          {
            type: "overflow",
            action_id: "overflow_remove",
            options: [
              {
                text: { type: "plain_text", text: "Remove" },
                value: `${index}`,
              },
            ],
          },
        ],
      });

      if (index < shoppingList.length - 1) {
        blocks.push({ type: "divider" });
      }
    });
  }

  blocks.push({
    type: "actions",
    elements: [
      {
        type: "button",
        text: { type: "plain_text", text: "➕ Add Item" },
        action_id: "open_add_item_modal",
      },
    ],
  });

  return blocks;
}

// Update home tab for a user
async function updateHomeTab(client, userId) {
  try {
    await client.views.publish({
      user_id: userId,
      view: {
        type: "home",
        blocks: generateBlocks(),
      },
    });
  } catch (error) {
    console.error("Error publishing home tab:", error);
  }
}

// App home opened event — update the home tab
app.event("app_home_opened", async ({ event, client }) => {
  await updateHomeTab(client, event.user);
});

// Button: toggle status Purchased <-> Needed
app.action("toggle_status", async ({ ack, body, action, client }) => {
  await ack();

  const index = parseInt(action.value, 10);
  if (shoppingList[index]) {
    const item = shoppingList[index];
    item.status = item.status === "Purchased" ? "Needed" : "Purchased";
    item.updatedAt = new Date();
    item.updatedBy = body.user.username || body.user.name || "unknown";
  }

  await updateHomeTab(client, body.user.id);
});

// Overflow menu: Remove item
app.action("overflow_remove", async ({ ack, action, body, client }) => {
  await ack();

  const index = parseInt(action.selected_option.value, 10);
  if (shoppingList[index]) {
    shoppingList.splice(index, 1);
  }

  await updateHomeTab(client, body.user.id);
});

// Open add item modal
app.action("open_add_item_modal", async ({ ack, client, body }) => {
  await ack();

  try {
    await client.views.open({
      trigger_id: body.trigger_id,
      view: {
        type: "modal",
        callback_id: "add_item_modal",
        title: {
          type: "plain_text",
          text: "Add Item",
        },
        submit: {
          type: "plain_text",
          text: "Add",
        },
        close: {
          type: "plain_text",
          text: "Cancel",
        },
        blocks: [
          {
            type: "input",
            block_id: "name_block",
            element: {
              type: "plain_text_input",
              action_id: "name_input",
              placeholder: { type: "plain_text", text: "Item name" },
            },
            label: {
              type: "plain_text",
              text: "Item Name",
            },
          },
          {
            type: "input",
            block_id: "link_block",
            optional: true,
            element: {
              type: "plain_text_input",
              action_id: "link_input",
              placeholder: { type: "plain_text", text: "Optional link" },
            },
            label: {
              type: "plain_text",
              text: "Link",
            },
          },
        ],
      },
    });
  } catch (error) {
    console.error("Error opening modal:", error);
  }
});

// Handle submission of add item modal
app.view("add_item_modal", async ({ ack, view, body, client }) => {
  await ack();

  const name = view.state.values.name_block.name_input.value;
  const link = view.state.values.link_block.link_input.value;

  if (!name) {
    // Should never happen because input is required
    return;
  }

  shoppingList.push({
    name,
    link,
    status: "Needed",
    updatedAt: new Date(),
    updatedBy: body.user.username || body.user.name || "unknown",
  });

  await updateHomeTab(client, body.user.id);
});

(async () => {
  const port = process.env.PORT || 3000;

  await app.start(port);

  console.log(`⚡️ Slack Bolt app is running on port ${port}!`);
})();
