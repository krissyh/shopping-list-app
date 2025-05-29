const fs = require("fs");
const path = require("path");
const { App } = require("@slack/bolt");
require("dotenv").config();

const DATA_FILE = path.join(__dirname, "shopping-list.json");

// Load and save helpers
function loadShoppingList() {
  try {
    const data = fs.readFileSync(DATA_FILE, "utf8");
    return JSON.parse(data);
  } catch {
    return [];
  }
}

function saveShoppingList(list) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(list, null, 2));
}

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  port: process.env.PORT || 3000,
});

let shoppingList = loadShoppingList();

function formatList() {
  return shoppingList.map(item => {
    const dateOnly = item.updatedAt
      ? new Date(item.updatedAt).toLocaleDateString()
      : "—";
    
    const link = item.link ? `<${item.link}|Link>` : "—";
    const who = item.updatedBy || "—";
    const status = item.status || "—";
    const name = item.name || "—";

    return `• *${name}* | ${link} | ${dateOnly} | ${who} | ${status}`;
  }).join("\n") || "No items on the list.";
}

// /shopping command
app.command("/shopping", async ({ command, ack, respond }) => {
  await ack();

  const [action, ...itemParts] = command.text.trim().split(" ");
  const itemName = itemParts.join(" ");
  const user = `<@${command.user_id}>`;
  const timestamp = new Date().toLocaleString();

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
      await respond(`🛒 *Shopping List:*\n${formatList()}`);
      break;
    default:
      await respond("Usage: `/shopping [add|check|uncheck|remove|list] [item name]`");
  }
});

// /shopping-ui command
app.command("/shopping-ui", async ({ command, ack, respond }) => {
  await ack();

  const blocks = [
    ...(shoppingList.length === 0
      ? [{ type: "section", text: { type: "mrkdwn", text: "🛒 Shopping list is empty." } }]
      : shoppingList.map((item, index) => ({
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*${item.name}* — ${item.status} ${item.link ? `<${item.link}|Link>` : ""} ${item.updatedAt ? `(updated ${item.updatedAt} by ${item.updatedBy})` : ""}`,
          },
          accessory: {
            type: "overflow",
            options: [
              ...(item.status === "Needed"
                ? [{ text: { type: "plain_text", text: "✅ Mark as Purchased" }, value: `check_${index}` }]
                : [{ text: { type: "plain_text", text: "🔄 Mark as Needed Again" }, value: `uncheck_${index}` }]
              ),
              { text: { type: "plain_text", text: "❌ Remove Item" }, value: `remove_${index}` },
            ],
            action_id: "item_action",
          },
        }))
    ),
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

  await respond({ blocks, text: "Here’s the shopping list:" });
});

// Overflow menu actions
app.action("item_action", async ({ ack, body, action, respond }) => {
  await ack();

  const user = `<@${body.user.id}>`;
  const timestamp = new Date().toLocaleString();
  const [actionType, indexStr] = action.selected_option.value.split("_");
  const index = parseInt(indexStr);

  if (isNaN(index) || !shoppingList[index]) {
    await respond({ text: "Invalid item index.", replace_original: false });
    return;
  }

  const item = shoppingList[index];
  let message;

  switch (actionType) {
    case "check":
      item.status = "Purchased";
      item.updatedBy = user;
      item.updatedAt = timestamp;
      message = `✅ Marked *${item.name}* as purchased.`;
      break;
    case "uncheck":
      item.status = "Needed";
      item.updatedBy = user;
      item.updatedAt = timestamp;
      message = `🔄 Marked *${item.name}* as needed again.`;
      break;
    case "remove":
      shoppingList.splice(index, 1);
      message = `❌ Removed *${item.name}* from the list.`;
      break;
    default:
      message = "Unknown action.";
  }

  saveShoppingList(shoppingList);

  await respond({
    response_type: "ephemeral",
    text: message,
  });
});

// Open modal to add item
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

// Handle modal submit
app.view("add_item_submit", async ({ ack, body, view, client }) => {
  await ack();

  const itemName = view.state.values.item_name.input.value.trim();
  const itemLink = view.state.values.item_link?.input?.value?.trim();
  const user = `<@${body.user.id}>`;
  const timestamp = new Date().toLocaleString();

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
});

// Home tab view
app.event("app_home_opened", async ({ event, client }) => {
  const headerRow = "*Item*\u2003\u2003\u2003| *Link*\u2003\u2003| *Date*\u2003\u2003| *Who*\u2003\u2003| *Status*";

  const itemRows = shoppingList.map(item => {
  const dateOnly = item.updatedAt
    ? new Date(item.updatedAt).toLocaleDateString()
    : "—";
  const link = item.link ? `<${item.link}|Link>` : "—";
  const who = item.updatedBy || "—";
  const status = item.status || "—";
  const name = item.name || "—";

  return `${name}\u2003\u2003\u2003| ${link}\u2003\u2003| ${dateOnly}\u2003\u2003| ${who}\u2003\u2003| ${status}`;
});


  const blocks = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "*🛒 Shopping List*\n\n" + [headerRow, ...itemRows].join("\n"),
      },
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

  await client.views.publish({
    user_id: event.user,
    view: {
      type: "home",
      callback_id: "home_view",
      blocks,
    },
  });
});

// Start the app
(async () => {
  await app.start();
  console.log("⚡️ Slack Shopping List App is running on port 3000");
})();
