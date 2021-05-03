exports.automation = async (event, context) => {

  const puppeteer = require('puppeteer');
  const moment = require('moment-timezone');
  moment.tz.setDefault('Europe/Berlin');

  const date = moment().add(8, 'days');
  const dateString = date.format("YYYY-MM-DD");
  const timeString = '19:00'.replace(':', '\\:');
  if (!(date.weekday() === 1 || date.weekday() === 3)) {
    console.log('Wrong day, canceling.')
    return;
  }

  const browser = await puppeteer.launch({ args: ['--no-zygote', '--no-sandbox'] });
  try {
    const page = await browser.newPage();

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
    await page.goto('https://ssl.forumedia.eu/zhs-courtbuchung.de/');
    if (await page.$('#login_block')) {
      console.debug('Start Login');

      await page.$eval('#login', el => el.value = 'adamnyberg');
      await page.$eval('#password', el => el.value = '34vr0z&OX8t65J0dEp');
      await page.$eval('form[name="login"]', form => form.submit());
      await page.waitForTimeout(1000);
    }

    if (await page.$('#login_block_auth')) {
      console.debug('Login succeded');
    } else {
      console.debug('Login failed');
    }

    // Book
    let bookingSucceded = false;
    let areaId = 6;

    while (!bookingSucceded) {
      if (areaId > 13) {
        break;
      }
      console.debug(`Trying to book: date=${dateString}, time=${timeString}, areaId=${areaId}`);

      const bookURL = `https://ssl.forumedia.eu/zhs-courtbuchung.de/reservations.php?action=showRevervations&type_id=1&date=${dateString}&page=3`;
      await page.goto(bookURL);
      await page.waitForTimeout(1000);

      const checkboxSelector = `#order_el_${areaId}_${timeString}`;
      if (await page.$(checkboxSelector)) {
        await page.evaluate(({ checkboxSelector }) => {
          const element = document.querySelector(checkboxSelector);
          element.click();
          element.form.submit();
        }, { checkboxSelector });

        await page.waitForNavigation();

        if (await page.$('input[value="Bestätigen"]')) {
          console.debug('Select of time succeded');
          await page.$eval('form[name="order"]', form => form.submit());
        } else {
          console.debug('Select of time failed');
          continue;
        }
        await page.waitForTimeout(1000);

        if (await page.$eval('.content h2', element => element.innerHTML) === 'Vielen Dank') {
          console.debug('Booking succeded');
          bookingSucceded = true;
        } else {
          console.debug('Booking failed');
          continue;
        }
      } else {
        console.debug('Non-bookable time, continuing');
      }
      areaId++;
    }

    if (bookingSucceded) {
      console.log(`Booking completed: date=${dateString}, time=${timeString}, areaId=${areaId - 1}`);
    } else {
      console.log('No booking made. No spots available.')
    }
    
    await browser.close();
  } catch (e) {
    console.error(e);
    await browser.close();
  }
};