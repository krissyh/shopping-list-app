// index.js
const { App } = require("@slack/bolt");
const { v4: uuidv4 } = require("uuid");

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN,
});

let items = [];

function buildHomeView() {
  const blocks = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "*Shopping List*",
      },
      accessory: {
        type: "button",
        text: {
          type: "plain_text",
          text: "Add Item"
        },
        action_id: "add_item_modal",
      },
    },
    {
      type: "divider",
    },
  ];

  items.forEach((item, index) => {
    blocks.push(
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `${item.status === "Purchased" ? "~" : ""}${item.name}${item.status === "Purchased" ? "~" : ""}`,
        },
        accessory: {
          type: "overflow",
          options: [
            {
              text: {
                type: "plain_text",
                text: "Remove"
              },
              value: `${index}`,
            },
          ],
          action_id: "remove_item_overflow",
        },
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: {
              type: "plain_text",
              text: item.status === "Purchased" ? "Mark as Needed" : "Mark as Purchased"
            },
            style: item.status === "Purchased" ? "danger" : "primary",
            value: `${index}`,
            action_id: "toggle_status",
          },
        ],
      },
      {
        type: "divider",
      }
    );
  });

  return {
    type: "home",
    callback_id: "home_view",
    blocks,
  };
}

app.event("app_home_opened", async ({ event, client }) => {
  try {
    await client.views.publish({
      user_id: event.user,
      view: buildHomeView(),
    });
  } catch (error) {
    console.error("Error publishing home tab:", error);
  }
});

app.action("add_item_modal", async ({ ack, body, client }) => {
  await ack();

  await client.views.open({
    trigger_id: body.trigger_id,
    view: {
      type: "modal",
      callback_id: "submit_item",
      title: {
        type: "plain_text",
        text: "Add Shopping Item",
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
          block_id: "item_input",
          label: {
            type: "plain_text",
            text: "Item name",
          },
          element: {
            type: "plain_text_input",
            action_id: "name",
          },
        },
      ],
    },
  });
});

app.view("submit_item", async ({ ack, body, view, client }) => {
  await ack();

  const name = view.state.values.item_input.name.value;
  items.push({ id: uuidv4(), name, status: "Needed" });

  await client.views.publish({
    user_id: body.user.id,
    view: buildHomeView(),
  });
});

app.action("toggle_status", async ({ ack, body, client, action }) => {
  await ack();

  const index = parseInt(action.value, 10);
  if (items[index]) {
    items[index].status = items[index].status === "Purchased" ? "Needed" : "Purchased";
  }

  await client.views.publish({
    user_id: body.user.id,
    view: buildHomeView(),
  });
});

app.action("remove_item_overflow", async ({ ack, body, client, action }) => {
  await ack();
  const index = parseInt(action.selected_option.value, 10);
  items.splice(index, 1);

  await client.views.publish({
    user_id: body.user.id,
    view: buildHomeView(),
  });
});

(async () => {
  await app.start(process.env.PORT || 3000);
  console.log("⚡️ Slack Bolt app is running!");
})();
