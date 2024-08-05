const { WebClient } = require("@slack/web-api");
const puppeteer = require("puppeteer");
const { Storage } = require("@google-cloud/storage");
const moment = require("moment-timezone");

exports.automation = async (event, context) => {
  // Config (weekdays and timespan)
  const BOOK_DAYS = [
    { day: 1, startHour: 18 }, // Monday
    { day: 2, startHour: 18 }, // Tuesday
    { day: 3, startHour: 18 }, // Wednesday
    { day: 4, startHour: 18 }, // Thursday
    { day: 5, startHour: 18 }, // Friday
    { day: 6, startHour: 21 }, // Saturday
    { day: 7, startHour: 21 }, // Sunday
  ];

  // Go to today
  moment.tz.setDefault("Europe/Berlin");

  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage();

  await page.setViewport({
    width: 1900,
    height: 1080,
    deviceScaleFactor: 1,
  });

  function handleClose(msg) {
    console.log(msg);
    page.close();
    browser.close();
    process.exit(1);
  }

  process.on("uncaughtException", () => {
    handleClose(`I crashed`);
  });

  process.on("unhandledRejection", () => {
    handleClose(`I was rejected`);
  });

  await login(page);

  try {
    const pagesNrs = [2, 3, 4, 5];
    const days = [moment(), moment().add(1, "days")];
    const spots = [];

    for (const day of days) {
      const todayString = day.format("YYYY-MM-DD");
      const foundDay = BOOK_DAYS.find(
        (element) => element.day === day.isoWeekday()
      );

      for (const pageNr of pagesNrs) {
        const availableSpots = await getSpotsOnPage(
          page,
          todayString,
          pageNr,
          foundDay.startHour
        );
        spots.push(...availableSpots);
      }
    }

    if (spots.length > 0) {
      // Fetch stored spots
      const storedSpots = await getStoredSpots();

      // Check if there are any new spots
      const newSpots = spots.filter(
        (spot) =>
          !storedSpots.some((storedSpot) => compareSpots(spot, storedSpot))
      );

      if (newSpots.length > 0) {
        await notifySlack(spots);
        await storeSpots(spots);
      } else {
        console.log("No new spots found");
      }
    } else {
      console.log("No spots found");
    }
  } catch (e) {
    console.error(e);
    await browser.close();
  }
  await browser.close();
};

async function login(page) {
  // Login
  await page.goto("https://ssl.forumedia.eu/zhs-courtbuchung.de/");
  if (await page.$("#login_block")) {
    await page.$eval("#login", (el) => (el.value = "username"));
    await page.$eval("#password", (el) => (el.value = "password"));
    await page.$eval('form[name="login"]', (form) => form.submit());
    await page.waitForTimeout(1000);
  }

  if (await page.$("#login_block_auth")) {
  } else {
    console.debug("Login failed");
  }
}

async function getSpotsOnPage(page, date, pageNr, startHour) {
  // console.debug(
  //   `Checking: date=${date}, startHour=${startHour}, page=${pageNr}`
  // );
  const availableSpots = [];

  const bookURL = `https://ssl.forumedia.eu/zhs-courtbuchung.de/reservations.php?action=showRevervations&type_id=1&date=${date}&page=${pageNr}`;
  await page.goto(bookURL);
  const ids = [];

  const availableSpotsHandle = await page.$$("input[type=checkbox]");
  for (const spot of availableSpotsHandle) {
    const jsHandle = await spot.getProperty("id");
    ids.push(await jsHandle.jsonValue());
  }
  // filter all times before startHour
  const filtered = ids.filter((id) => {
    const hour = id.split("_")[3].split(":")[0];
    return hour >= startHour;
  });

  filtered.forEach((spot) => {
    let courtNr = spot.split("_")[2];
    if (courtNr === "57") {
      courtNr = "22";
    }
    const time = spot.split("_")[3];
    availableSpots.push({ date, courtNr, time });
  });

  return availableSpots;
}

const STORED_SPOTS_FILE_NAME = "spots.json";
const storage = new Storage({
  projectId: "gcp-project",
});
const bucket = storage.bucket("tennis-spots");

async function getStoredSpots() {
  const file = bucket.file(STORED_SPOTS_FILE_NAME);
  const [exists] = await file.exists();
  if (exists) {
    const data = await file.download();
    return JSON.parse(data.toString());
  } else {
    return [];
  }
}

async function storeSpots(spots) {
  const file = bucket.file(STORED_SPOTS_FILE_NAME);
  file.save(JSON.stringify(spots));
}

async function notifySlack(spots) {
  const web = new WebClient(process.env.SLACK_TOKEN);

  const text =
    "<!channel> Available spots \n" +
    spots
      .map((spot) => {
        const dayString =
          spot.date === moment().format("YYYY-MM-DD") ? "Today" : "Tomorrow";
        return `${dayString} at ${spot.time} on court ${spot.courtNr}`;
      })
      .join("\n");

  try {
    await web.chat.postMessage({
      channel: "#available-spots",
      text,
    });
    console.log("Slack msg: ", text.replace(/\n/g, " "));
  } catch (error) {
    console.log(error);
  }
}

function compareSpots(a, b) {
  return (
    Object.entries(a).sort().toString() === Object.entries(b).sort().toString()
  );
}
