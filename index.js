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
  return dateTime ? new Date(dateTime).toLocaleDateString() : "";
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

      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${item.name}*${item.link ? ` <${item.link}|Link>` : ""}\nStatus: *${item.status}* ${updatedText}`,
        },
        accessory: {
          type: "actions",
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: "✔️", emoji: true },
              style: item.status === "Purchased" ? "primary" : undefined, // green if Purchased, grey otherwise
              value: `${item.status === "Needed" ? "check" : "uncheck"}_${index}`,
              action_id: `item_action_check_${index}`,
            },
            {
              type: "overflow",
              options: [
                {
                  text: { type: "plain_text", text: "Remove", emoji: true },
                  value: `remove_${index}`,
                },
              ],
              action_id: `item_action_overflow_${index}`,
            },
          ],
        },
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

// Slash command: /shopping
app.command("/shopping", async ({ command, ack, respond }) => {
  await ack();

  const [action, ...itemParts] = command.text.trim().split(" ");
  const itemName = itemParts.join(" ");
  const user = `<@${command.user_id}>`;
  const timestamp = new Date().toISOString();

  switch (action) {
    case "add":
      shoppingList.push({ name: itemName, status: "Needed", updatedBy: user, updatedAt: timestamp });
      saveShoppingList(shoppingList);
      await respond(`Added *${itemName}* to the shopping list.`);
      break;
    case "check":
      shoppingList = shoppingList.map(item =>
        item.name === itemName ? { ...item, status: "Purchased", updatedBy: user, updatedAt: timestamp } : item
      );
      saveShoppingList(shoppingList);
      await respond(`Marked *${itemName}* as purchased.`);
      break;
    case "uncheck":
      shoppingList = shoppingList.map(item =>
        item.name === itemName ? { ...item, status: "Needed", updatedBy: user, updatedAt: timestamp } : item
      );
      saveShoppingList(shoppingList);
      await respond(`Marked *${itemName}* as needed again.`);
      break;
    case "remove":
      shoppingList = shoppingList.filter(item => item.name !== itemName);
      saveShoppingList(shoppingList);
      await respond(`Removed *${itemName}* from the list.`);
      break;
    case "list":
      await respond(`🛒 *Shopping List:*\n${shoppingList.length ? shoppingList.map(item => `• *${item.name}* — ${item.status}`).join("\n") : "No items on the list."}`);
      break;
    default:
      await respond("Usage: `/shopping [add|check|uncheck|remove|list] [item name]`");
  }
});

// Slash command: /shopping-ui
app.command("/shopping-ui", async ({ command, ack, respond }) => {
  await ack();

  const blocks = generateBlocks();
  await respond({ blocks, text: "Here’s the shopping list:" });
});

// Check/uncheck button handler
app.action(/item_action_check_\d+/, async ({ ack, body, action, respond }) => {
  await ack();

  const user = `<@${body.user.id}>`;
  const timestamp = new Date().toISOString();

  const [actionType, indexStr] = action.value.split("_");
  const index = parseInt(indexStr);

  if (isNaN(index) || !shoppingList[index]) {
    await respond({ text: "Invalid item index.", replace_original: false });
    return;
  }

  let item = shoppingList[index];
  let message;

  if (actionType === "check") {
    item.status = "Purchased";
    message = `✅ Marked *${item.name}* as purchased.`;
  } else if (actionType === "uncheck") {
    item.status = "Needed";
    message = `🔄 Marked *${item.name}* as needed again.`;
  } else {
    message = "Unknown action.";
  }

  item.updatedBy = user;
  item.updatedAt = timestamp;

  saveShoppingList(shoppingList);

  const blocks = generateBlocks();

  await respond({
    replace_original: true,
    blocks,
    text: "Here’s the updated shopping list.",
  });

  await respond({ response_type: "ephemeral", text: message });
});

// Overflow menu handler (remove)
app.action(/item_action_overflow_\d+/, async ({ ack, body, action, respond }) => {
  await ack();

  const selected = action.selected_option.value; // e.g., "remove_1"
  const [actionType, indexStr] = selected.split("_");
  const index = parseInt(indexStr);

  if (actionType !== "remove" || isNaN(index) || !shoppingList[index]) {
    await respond({ text: "Invalid action or item.", replace_original: false });
    return;
  }

  const removedItem = shoppingList.splice(index, 1)[0];
  saveShoppingList(shoppingList);

  const blocks = generateBlocks();

  await respond({
    replace_original: true,
    blocks,
    text: "Here’s the updated shopping list.",
  });

  await respond({ response_type: "ephemeral", text: `❌ Removed *${removedItem.name}* from the list.` });
});

// Add Item Modal open
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

// Modal submission handler
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

  const blocks = generateBlocks();

  await client.views.publish({
    user_id: body.user.id,
    view: {
      type: "home",
      callback_id: "home_view",
      blocks,
    },
  });
});

// Home tab auto update
app.event("app_home_opened", async ({ event, client }) => {
  const blocks = generateBlocks();

  await client.views.publish({
    user_id: event.user,
    view: {
      type: "home",
      callback_id: "home_view",
      blocks,
    },
  });
});

(async () => {
  await app.start();
  console.log("⚡️ Slack Shopping List App is running");
})();
