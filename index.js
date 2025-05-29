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
  socketMode: false, // Assuming you use Events API
  port: process.env.PORT || 3000,
});

let shoppingList = loadShoppingList();

function formatList() {
  return (
    shoppingList
      .map(
        (item) =>
          `• *${item.name}* — ${item.status}${
            item.link ? ` <${item.link}|Link>` : ""
          } ${
            item.updatedAt ? `(updated ${item.updatedAt} by ${item.updatedBy})` : ""
          }`
      )
      .join("\n") || "No items on the list."
  );
}

function formatDate(dateTime) {
  if (!dateTime) return "Unknown date";
  return new Date(dateTime).toLocaleDateString();
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
      if (!itemName) {
        await respond("Please provide an item name to add.");
        return;
      }
      shoppingList.push({
        name: itemName,
        status: "Needed",
        updatedBy: user,
        updatedAt: timestamp,
      });
      saveShoppingList(shoppingList);
      await respond(`Added *${itemName}* to the shopping list.`);
      break;

    case "check":
      shoppingList = shoppingList.map((item) =>
        item.name === itemName
          ? { ...item, status: "Purchased", updatedBy: user, updatedAt: timestamp }
          : item
      );
      saveShoppingList(shoppingList);
      await respond(`Marked *${itemName}* as purchased.`);
      break;

    case "uncheck":
      shoppingList = shoppingList.map((item) =>
        item.name === itemName
          ? { ...item, status: "Needed", updatedBy: user, updatedAt: timestamp }
          : item
      );
      saveShoppingList(shoppingList);
      await respond(`Marked *${itemName}* as needed again.`);
      break;

    case "remove":
      shoppingList = shoppingList.filter((item) => item.name !== itemName);
      saveShoppingList(shoppingList);
      await respond(`Removed *${itemName}* from the list.`);
      break;

    case "list":
      await respond(`🛒 *Shopping List:*\n${formatList()}`);
      break;

    default:
      await respond(
        "Usage: `/shopping [add|check|uncheck|remove|list] [item name]`"
      );
  }
});

// Slash command: /shopping-ui
app.command("/shopping-ui", async ({ command, ack, respond }) => {
  await ack();

  const blocks = generateBlocks();
  await respond({ blocks, text: "Here’s the shopping list:" });
});

function generateBlocks() {
  return [
    {
      type: "header",
      text: { type: "plain_text", text: "🛒 Shopping List" },
    },
    ...(shoppingList.length === 0
      ? [
          {
            type: "section",
            text: { type: "mrkdwn", text: "The shopping list is empty." },
          },
        ]
      : shoppingList.flatMap((item, index) => [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*${item.name}* | ${
                item.link ? `<${item.link}|Link>` : "No link"
              } | ${formatDate(item.updatedAt)} | ${item.updatedBy} | ${
                item.status
              }`,
            },
          },
          {
            type: "actions",
            elements: [
              item.status === "Needed"
                ? {
                    type: "button",
                    text: { type: "plain_text", text: "✅ Purchased" },
                    style: "primary",
                    value: `check_${index}`,
                    action_id: `check_${index}`,
                  }
                : {
                    type: "button",
                    text: { type: "plain_text", text: "🔄 Needed" },
                    style: "primary",
                    value: `uncheck_${index}`,
                    action_id: `uncheck_${index}`,
                  },
              {
                type: "button",
                text: { type: "plain_text", text: "❌ Remove" },
                style: "danger",
                value: `remove_${index}`,
                action_id: `remove_${index}`,
              },
            ],
          },
        ])),
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

app.action(/^(check|uncheck|remove)_\d+$/, async ({ ack, body, action, respond, client }) => {
  await ack();

  const user = `<@${body.user.id}>`;
  const timestamp = new Date().toISOString();

  // action.action_id example: "check_0", "remove_2"
  const [actionType, indexStr] = action.action_id.split("_");
  const index = parseInt(indexStr, 10);

  if (isNaN(index) || !shoppingList[index]) {
    await respond({ text: "Invalid item index.", replace_original: false });
    return;
  }

  let message = "";
  let item = shoppingList[index];

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
  const blocks = generateBlocks();

  // Replace original message with updated list
  await respond({
    replace_original: true,
    blocks,
    text: "Here’s the updated shopping list.",
  });

  // Send ephemeral confirmation message
  // channel id is available on body.message.channel.id for messages, or body.channel.id sometimes
  const channelId = body.channel?.id || (body.message && body.message.channel?.id);
  if (channelId) {
    await client.chat.postEphemeral({
      channel: channelId,
      user: body.user.id,
      text: message,
    });
  }
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
