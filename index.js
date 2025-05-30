const fs = require("fs");
const path = require("path");
const { App } = require("@slack/bolt");
require("dotenv").config();

const DATA_FILE = path.join(__dirname, "shopping-list.json");

function loadShoppingList() {
  try {
    const data = fs.readFileSync(DATA_FILE, "utf8");
    return JSON.parse(data);
  } catch (err) {
    return [];
  }
}

function saveShoppingList(list) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(list, null, 2));
}

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: false,
  appToken: process.env.SLACK_APP_TOKEN,
  port: process.env.PORT || 3000,
});

let shoppingList = loadShoppingList();

function formatDate(dateTime) {
  if (!dateTime) return "Unknown date";
  return new Date(dateTime).toLocaleDateString();
}

function generateBlocks() {
  if (shoppingList.length === 0) {
    return [
      {
        type: "header",
        text: { type: "plain_text", text: "🛒 Shopping List" },
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: "The shopping list is empty." },
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "➕ Add Item" },
            action_id: "open_add_item_modal",
          },
        ],
      },
    ];
  }

  const blocks = [
    {
      type: "header",
      text: { type: "plain_text", text: "🛒 Shopping List" },
    },
  ];

  shoppingList.forEach((item, index) => {
    const statusText = item.status === "Needed" ? "Needed" : "Purchased";
    const statusEmoji = item.status === "Needed" ? "🛒" : "✅";
    const accessoryOptions = [
      {
        text: {
          type: "plain_text",
          text: item.status === "Needed" ? "Mark Purchased" : "Mark Needed",
          emoji: true,
        },
        value: `toggle_${index}`,
      },
      {
        text: {
          type: "plain_text",
          text: "Remove",
          emoji: true,
        },
        value: `remove_${index}`,
      },
    ];

    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${item.name}* ${item.link ? `<${item.link}|Link>` : ""}\n${statusEmoji} *${statusText}* | Updated: ${formatDate(item.updatedAt)} by ${item.updatedBy}`,
      },
      accessory: {
        type: "overflow",
        options: accessoryOptions,
        action_id: `item_action_${index}`,
      },
    });
  });

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

async function updateAllHomeTabs(client) {
  const userIds = new Set(shoppingList.map(item => item.updatedBy.replace(/[<@>]/g, "")));

  for (const userId of userIds) {
    try {
      await client.views.publish({
        user_id: userId,
        view: {
          type: "home",
          callback_id: "home_view",
          blocks: generateBlocks(),
        },
      });
    } catch (err) {
      console.error(`Error publishing home tab for ${userId}:`, err);
    }
  }
}

app.command("/shopping", async ({ command, ack, respond }) => {
  await ack();

  const [action, ...itemParts] = command.text.trim().split(" ");
  const itemName = itemParts.join(" ");
  const user = `<@${command.user_id}>`;
  const timestamp = new Date().toISOString();

  switch (action) {
    case "add":
      if (!itemName) return await respond("Please provide an item name to add.");
      shoppingList.push({ name: itemName, status: "Needed", updatedBy: user, updatedAt: timestamp });
      break;
    case "check":
      shoppingList = shoppingList.map(item =>
        item.name === itemName ? { ...item, status: "Purchased", updatedBy: user, updatedAt: timestamp } : item
      );
      break;
    case "uncheck":
      shoppingList = shoppingList.map(item =>
        item.name === itemName ? { ...item, status: "Needed", updatedBy: user, updatedAt: timestamp } : item
      );
      break;
    case "remove":
      shoppingList = shoppingList.filter(item => item.name !== itemName);
      break;
    case "list":
      return await respond(`🛒 *Shopping List:*\n${shoppingList.length ? shoppingList.map(i => `• *${i.name}* — ${i.status}`).join("\n") : "No items on the list."}`);
    default:
      return await respond("Usage: `/shopping [add|check|uncheck|remove|list] [item name]`");
  }

  saveShoppingList(shoppingList);
  await respond(`Updated shopping list.`);
  await updateAllHomeTabs(app.client);
});

app.command("/shopping-ui", async ({ command, ack, respond }) => {
  await ack();
  await respond({ blocks: generateBlocks(), text: "Here’s the shopping list:" });
});

app.action(/item_action_\d+/, async ({ ack, body, action, client }) => {
  await ack();

  const user = `<@${body.user.id}>`;
  const timestamp = new Date().toISOString();

  const [actionType, indexStr] = action.selected_option.value.split("_");
  const index = parseInt(indexStr, 10);

  if (isNaN(index) || !shoppingList[index]) return;

  let message = "";
  let item = shoppingList[index];

  switch (actionType) {
    case "toggle":
      item.status = item.status === "Needed" ? "Purchased" : "Needed";
      item.updatedBy = user;
      item.updatedAt = timestamp;
      message = `Updated *${item.name}* to *${item.status}*.`;
      break;
    case "remove":
      shoppingList.splice(index, 1);
      message = `Removed *${item.name}* from the list.`;
      break;
    default:
      return;
  }

  saveShoppingList(shoppingList);

  try {
    await client.chat.postEphemeral({
      channel: body.user.id,
      user: body.user.id,
      text: message,
    });
  } catch (e) {
    console.error("Failed to send ephemeral message:", e);
  }

  await updateAllHomeTabs(client);
});

app.action("open_add_item_modal", async ({ ack, body, client }) => {
  await ack();

  await client.views.open({
    trigger_id: body.trigger_id,
    view: {
      type: "modal",
      callback_id: "add_item_submit",
      title: { type: "plain_text", text: "Add Shopping Item" },
      submit: { type: "plain_text", text: "Add" },
      close: { type: "plain_text", text: "Cancel" },
      blocks: [
        {
          type: "input",
          block_id: "item_name",
          label: { type: "plain_text", text: "Item Name" },
          element: { type: "plain_text_input", action_id: "input" },
        },
        {
          type: "input",
          optional: true,
          block_id: "item_link",
          label: { type: "plain_text", text: "Optional Link" },
          element: { type: "plain_text_input", action_id: "input" },
        },
      ],
    },
  });
});

app.view("add_item_submit", async ({ ack, body, view, client }) => {
  await ack();

  const itemName = view.state.values.item_name.input.value.trim();
  const itemLink = view.state.values.item_link?.input?.value?.trim();
  const user = `<@${body.user.id}>`;
  const timestamp = new Date().toISOString();

  if (!itemName) return;

  shoppingList.push({
    name: itemName,
    link: itemLink || null,
    status: "Needed",
    updatedBy: user,
    updatedAt: timestamp,
  });

  saveShoppingList(shoppingList);

  await client.chat.postEphemeral({
    channel: body.user.id,
    user: body.user.id,
    text: `Added *${itemName}* to the shopping list.`,
  });

  await updateAllHomeTabs(client);
});

app.event("app_home_opened", async ({ event, client }) => {
  await client.views.publish({
    user_id: event.user,
    view: {
      type: "home",
      callback_id: "home_view",
      blocks: generateBlocks(),
    },
  });
});

(async () => {
  await app.start();
  console.log("⚡️ Slack Shopping List App is running");
})();
