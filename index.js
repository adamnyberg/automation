exports.automation = async (event, context) => {
  const puppeteer = require("puppeteer-extra");
  const moment = require("moment-timezone");
  moment.tz.setDefault("Europe/Berlin");

  const StealthPlugin = require("puppeteer-extra-plugin-stealth");
  puppeteer.use(StealthPlugin());
  const AdblockerPlugin = require("puppeteer-extra-plugin-adblocker");
  puppeteer.use(AdblockerPlugin({ blockTrackers: true }));

  const BOOK_DAYS = [
    { day: 1, time: "19:00", hours: 1 }, // Monday
    { day: 3, time: "19:00", hours: 1 }, // Wednesday
    { day: 4, time: "19:00", hours: 1 }, // Thursday
    { day: 5, time: "19:00", hours: 1 }, // Friday
    { day: 6, time: "11:00", hours: 2 }, // Saturday
    { day: 7, time: "11:00", hours: 2 }, // Sunday
  ];

  const date = moment().add(8, "days");
  const dateString = date.format("YYYY-MM-DD");
  console.log(date.isoWeekday());
  const foundDay = BOOK_DAYS.find(
    (element) => element.day === date.isoWeekday()
  );
  if (!foundDay) {
    console.log("Wrong day, canceling.");
    return;
  }
  let timeString = foundDay.time.replace(":", "\\:");

  const browser = await puppeteer.launch({
    headless: false,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-infobars",
      "--window-position=0,0",
      "--ignore-certifcate-errors",
      "--ignore-certifcate-errors-spki-list",
      '--user-agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_12_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/65.0.3312.0 Safari/537.36"',
    ],
  });
  try {
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

    // Login
    await page.goto("https://ssl.forumedia.eu/zhs-courtbuchung.de/");
    if (await page.$("#login_block")) {
      console.debug("Start Login");

      await page.$eval("#login", (el) => (el.value = "adamnyberg"));
      await page.$eval("#password", (el) => (el.value = "34vr0z&OX8t65J0dEp"));
      await page.$eval('form[name="login"]', (form) => form.submit());
      await page.waitForTimeout(1000);
    }

    if (await page.$("#login_block_auth")) {
      console.debug("Login succeded");
    } else {
      console.debug("Login failed");
    }

    // Book
    let bookingSucceded = false;
    let areaId = 6;
    let bookingHours = foundDay.hours;

    while (!bookingSucceded && bookingHours >= 1) {
      if (areaId > 13) {
        break;
      }
      console.debug(
        `Trying to book: date=${dateString}, time=${timeString}, areaId=${areaId}`
      );

      const bookURL = `https://ssl.forumedia.eu/zhs-courtbuchung.de/reservations.php?action=showRevervations&type_id=1&date=${dateString}&page=3`;
      await page.goto(bookURL);
      await page.waitForTimeout(1000);

      const checkboxSelector = `#order_el_${areaId}_${timeString}`;
      if (await page.$(checkboxSelector)) {
        await page.evaluate(
          ({ checkboxSelector }) => {
            const element = document.querySelector(checkboxSelector);
            element.click();
            element.form.submit();
          },
          { checkboxSelector }
        );

        await page.waitForNavigation();

        if (await page.$('input[value="Bestätigen"]')) {
          console.debug("Select of time succeded");
          await page.$eval('form[name="order"]', (form) => form.submit());
        } else {
          console.debug("Select of time failed");
          continue;
        }
        await page.waitForTimeout(2000);

        await page.screenshot({ path: "screenshot.png" });

        if (
          (await page.$eval(".content h2", (element) => element.innerHTML)) ===
          "Vielen Dank"
        ) {
          console.log(
            `Booking completed: date=${dateString}, time=${timeString}, areaId=${
              areaId - 1
            }`
          );
          bookingSucceded = true;
          // Lower hours
          bookingHours--;
          // Update time string
          timeString = timeString.split("");
          timeString[1] = (parseInt(timeString[1]) + 1).toString();
          timeString = timeString.join("");
          // Lower area ID
          areaId--;
          console.log("bookingHours", bookingHours);
          console.log("timeString", timeString);
        } else {
          console.debug("Booking failed");
          continue;
        }
      } else {
        console.debug("Non-bookable time, continuing");
      }
      areaId++;
    }

    if (bookingSucceded) {
      console.log("All bookings done.");
    } else {
      console.log("No booking made. No spots available.");
    }

    await browser.close();
  } catch (e) {
    console.error(e);
    await browser.close();
  }
};
