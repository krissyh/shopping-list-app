const { App } = require("@slack/bolt");

// Your existing shopping list data source or in-memory array
let shoppingList = [
  // Example item:
  // { name: "Milk", status: "Needed", link: "https://example.com", updatedBy: null, updatedAt: null }
];

// Helper to save shopping list (implement as needed)
function saveShoppingList(list) {
  shoppingList = list;
  // Persist to DB or file if you want
}

// Format ISO date to human-readable (simple)
function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString() + " " + d.toLocaleTimeString();
}

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
      const updatedText = item.updatedAt && item.updatedBy
        ? `(updated ${formatDate(item.updatedAt)} by ${item.updatedBy})`
        : "";

      // Grey box for Needed, Green check for Purchased
      const statusEmoji = item.status === "Purchased" ? ":white_check_mark:" : ":white_large_square:";

      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `${statusEmoji} *${item.name}*${item.link ? ` <${item.link}|Link>` : ""}\nStatus: *${item.status}* ${updatedText}`,
        },
      });

      // Actions block below each item
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
            style: item.status === "Purchased" ? "danger" : "primary",
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

      // Divider between items except last
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

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  // Other configs...
});

app.event("app_home_opened", async ({ event, client }) => {
  try {
    await client.views.publish({
      user_id: event.user,
      view: {
        type: "home",
        blocks: generateBlocks(),
      },
    });
  } catch (error) {
    console.error(error);
  }
});

app.action("toggle_status", async ({ ack, body, action, client }) => {
  await ack();
  const index = parseInt(action.value);
  if (isNaN(index) || !shoppingList[index]) return;

  const user = `<@${body.user.id}>`;
  const timestamp = new Date().toISOString();

  if (shoppingList[index].status === "Purchased") {
    shoppingList[index].status = "Needed";
  } else {
    shoppingList[index].status = "Purchased";
  }
  shoppingList[index].updatedBy = user;
  shoppingList[index].updatedAt = timestamp;

  saveShoppingList(shoppingList);

  try {
    await client.views.publish({
      user_id: body.user.id,
      view: {
        type: "home",
        blocks: generateBlocks(),
      },
    });
  } catch (error) {
    console.error(error);
  }
});

app.action("overflow_remove", async ({ ack, body, action, client }) => {
  await ack();
  const index = parseInt(action.selected_option.value);
  if (isNaN(index) || !shoppingList[index]) return;

  const removedItem = shoppingList.splice(index, 1)[0];
  saveShoppingList(shoppingList);

  try {
    await client.views.publish({
      user_id: body.user.id,
      view: {
        type: "home",
        blocks: generateBlocks(),
      },
    });
  } catch (error) {
    console.error(error);
  }
});

app.action("open_add_item_modal", async ({ ack, body, client }) => {
  await ack();

  try {
    await client.views.open({
      trigger_id: body.trigger_id,
      view: {
        type: "modal",
        callback_id: "add_item_modal",
        title: { type: "plain_text", text: "Add Item" },
        submit: { type: "plain_text", text: "Add" },
        close: { type: "plain_text", text: "Cancel" },
        blocks: [
          {
            type: "input",
            block_id: "item_name_block",
            element: {
              type: "plain_text_input",
              action_id: "item_name_input",
              placeholder: { type: "plain_text", text: "Item name" },
            },
            label: { type: "plain_text", text: "Item Name" },
          },
          {
            type: "input",
            block_id: "item_link_block",
            optional: true,
            element: {
              type: "plain_text_input",
              action_id: "item_link_input",
              placeholder: { type: "plain_text", text: "Optional link" },
            },
            label: { type: "plain_text", text: "Link" },
          },
        ],
      },
    });
  } catch (error) {
    console.error(error);
  }
});

app.view("add_item_modal", async ({ ack, body, view, client }) => {
  await ack();

  const name = view.state.values.item_name_block.item_name_input.value;
  const link = view.state.values.item_link_block?.item_link_input?.value || null;
  if (!name) return;

  shoppingList.push({
    name,
    status: "Needed",
    link,
    updatedBy: `<@${body.user.id}>`,
    updatedAt: new Date().toISOString(),
  });

  saveShoppingList(shoppingList);

  try {
    await client.views.publish({
      user_id: body.user.id,
      view: {
        type: "home",
        blocks: generateBlocks(),
      },
    });
  } catch (error) {
    console.error(error);
  }
});

// Start your app
(async () => {
  const port = process.env.PORT || 3000;
  await app.start(port);
  console.log(`⚡️ Bolt app is running on port ${port}`);
})();
