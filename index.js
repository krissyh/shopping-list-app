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

function formatItemRow(item) {
  const name = `*${item.name}*`;
  const link = item.link ? `<${item.link}|🔗>` : "—";
  const date = item.updatedAt || "—";
  const who = item.updatedBy || "—";
  const status = item.status || "🛒";
  return `• ${name}   ${link}   📅 ${date}   👤 ${who}   ${status}`;
}

function buildHomeView(list) {
  const blocks = [
    {
      type: "header",
      text: { type: "plain_text", text: "🛍️ Your Shopping List" },
    },
    {
      type: "context",
      elements: [{ type: "mrkdwn", text: "*What*   🔗 *Link*   📅 *When*   👤 *Who*   🏷️ *Status*" }],
    },
    ...(list.length === 0
      ? [{
          type: "section",
          text: { type: "mrkdwn", text: "_The list is currently empty._" },
        }]
      : list.map((item, index) => ({
          type: "section",
          text: {
            type: "mrkdwn",
            text: formatItemRow(item),
          },
          accessory: {
            type: "overflow",
            options: [
              ...(item.status === "🛒 Needed"
                ? [{ text: { type: "plain_text", text: "✅ Mark as Purchased" }, value: `check_${index}` }]
                : [{ text: { type: "plain_text", text: "🔄 Mark as Needed" }, value: `uncheck_${index}` }]),
              { text: { type: "plain_text", text: "❌ Remove Item" }, value: `remove_${index}` },
            ],
            action_id: "item_action",
          },
        }))),
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

  return {
    type: "home",
    callback_id: "home_view",
    blocks,
  };
}

app.event("app_home_opened", async ({ event, client }) => {
  await client.views.publish({
    user_id: event.user,
    view: buildHomeView(shoppingList),
  });
});

app.command("/shopping", async ({ command, ack, respond }) => {
  await ack();
  const [action, ...itemParts] = command.text.trim().split(" ");
  const itemName = itemParts.join(" ");
  const user = `<@${command.user_id}>`;
  const timestamp = new Date().toLocaleDateString();

  switch (action) {
    case "add":
      shoppingList.push({ name: itemName, status: "🛒 Needed", updatedBy: user, updatedAt: timestamp });
      saveShoppingList(shoppingList);
      await respond(`Added *${itemName}* to the shopping list.`);
      break;
    case "check":
      shoppingList = shoppingList.map(item =>
        item.name === itemName ? { ...item, status: "✅ Purchased", updatedBy: user, updatedAt: timestamp } : item
      );
      saveShoppingList(shoppingList);
      await respond(`Marked *${itemName}* as purchased.`);
      break;
    case "uncheck":
      shoppingList = shoppingList.map(item =>
        item.name === itemName ? { ...item, status: "🛒 Needed", updatedBy: user, updatedAt: timestamp } : item
      );
      saveShoppingList(shoppingList);
      await respond(`Marked *${itemName}* as needed.`);
      break;
    case "remove":
      shoppingList = shoppingList.filter(item => item.name !== itemName);
      saveShoppingList(shoppingList);
      await respond(`Removed *${itemName}* from the list.`);
      break;
    case "list":
      await respond(`🛒 *Shopping List:*
${shoppingList.map(formatItemRow).join("\n")}`);
      break;
    default:
      await respond("Usage: `/shopping [add|check|uncheck|remove|list] [item name]`");
  }
});

app.action("item_action", async ({ ack, body, action, client }) => {
  await ack();

  const user = `<@${body.user.id}>`;
  const timestamp = new Date().toLocaleDateString();
  const [actionType, indexStr] = action.selected_option.value.split("_");
  const index = parseInt(indexStr);

  if (isNaN(index) || !shoppingList[index]) return;

  let item = shoppingList[index];
  let message;

  switch (actionType) {
    case "check":
      item.status = "✅ Purchased";
      message = `Marked *${item.name}* as purchased.`;
      break;
    case "uncheck":
      item.status = "🛒 Needed";
      message = `Marked *${item.name}* as needed.`;
      break;
    case "remove":
      shoppingList.splice(index, 1);
      message = `Removed *${item.name}*.`;
      break;
  }

  item.updatedBy = user;
  item.updatedAt = timestamp;
  saveShoppingList(shoppingList);

  try {
    await client.views.publish({
      user_id: body.user.id,
      view: buildHomeView(shoppingList),
    });
  } catch (err) {
    console.error("Error refreshing Home tab:", err);
  }

  await client.chat.postEphemeral({
    channel: body.channel.id,
    user: body.user.id,
    text: message,
  });
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
  const timestamp = new Date().toLocaleDateString();

  if (!itemName) return;

  shoppingList.push({
    name: itemName,
    link: itemLink || null,
    status: "🛒 Needed",
    updatedBy: user,
    updatedAt: timestamp,
  });

  saveShoppingList(shoppingList);

  await client.views.publish({
    user_id: body.user.id,
    view: buildHomeView(shoppingList),
  });
});

(async () => {
  await app.start();
  console.log("⚡️ Slack Shopping List App is running!");
})();
