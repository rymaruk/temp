const { google } = require('googleapis');

exports.exportReviewsToSheets = async (req, res) => {
  try {
    // 1. Авторизація
    const auth = new google.auth.GoogleAuth({
      scopes: [
        'https://www.googleapis.com/auth/business.manage',
        'https://www.googleapis.com/auth/spreadsheets'
      ]
    });
    const authClient = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: authClient });

    // Отримання ID таблиці
    const spreadsheetId = process.env.SPREADSHEET_ID;
    if (!spreadsheetId) {
      throw new Error('Не вказана змінна SPREADSHEET_ID');
    }

    // Вираховуємо дату (рівно 7 днів тому)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    let newReviews = [];

    // 2. Отримання ВСІХ акаунтів (компаній), доступних адміністратору
    const accountsRes = await authClient.request({
      url: 'https://mybusinessaccountmanagement.googleapis.com/v1/accounts',
      method: 'GET'
    });
    
    const accounts = accountsRes.data.accounts || [];
    console.log(`Знайдено акаунтів (компаній): ${accounts.length}`);

    // 3. Перебираємо кожну компанію
    for (const account of accounts) {
      const accountId = account.name; // Формат: 'accounts/123456789'
      const accountDisplayName = account.accountName || accountId;

      try {
        // Отримуємо всі локації для конкретної компанії (readMask обов'язковий для цього API)
        const locationsRes = await authClient.request({
          url: `https://mybusinessbusinessinformation.googleapis.com/v1/${accountId}/locations?readMask=name,title`,
          method: 'GET'
        });
        
        const locations = locationsRes.data.locations || [];

        // 4. Перебираємо кожну локацію
        for (const location of locations) {
          const locationName = location.name; 
          const locationTitle = location.title || 'Невідома локація';
          
          try {
            // Отримуємо відгуки для локації
            const reviewsRes = await authClient.request({
              url: `https://mybusinessreviews.googleapis.com/v1/${locationName}/reviews`,
              method: 'GET'
            });
            
            const reviews = reviewsRes.data.reviews || [];

            // 5. Фільтрація відгуків за останні 7 днів
            for (const review of reviews) {
              const reviewDate = new Date(review.createTime);
              
              if (reviewDate >= sevenDaysAgo) {
                newReviews.push([
                  accountDisplayName,                   // Колонка A: Назва компанії (Акаунта)
                  locationTitle,                        // Колонка B: Назва магазину (Локації)
                  review.reviewer.displayName || 'Анонім', // Колонка C: Ім'я клієнта
                  review.starRating,                    // Колонка D: Оцінка (FIVE, FOUR...)
                  review.comment || '(Без тексту)',     // Колонка E: Текст відгуку
                  reviewDate.toISOString()              // Колонка F: Дата
                ]);
              }
            }
          } catch (reviewErr) {
            console.warn(`Помилка отримання відгуків для ${locationTitle}:`, reviewErr.message);
          }
        }
      } catch (locErr) {
        console.warn(`Помилка отримання локацій для компанії ${accountDisplayName}:`, locErr.message);
      }
    }

    // 6. Запис у Google Sheets
    if (newReviews.length > 0) {
      await sheets.spreadsheets.values.append({
        spreadsheetId: spreadsheetId,
        range: 'Sheet1!A:F', // Записуємо в колонки від A до F
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: newReviews
        }
      });
      console.log(`Успішно додано ${newReviews.length} відгуків.`);
      res.status(200).send(`Додано ${newReviews.length} відгуків з усіх компаній.`);
    } else {
      console.log('Нових відгуків за останні 7 днів немає в жодній компанії.');
      res.status(200).send('Нових відгуків немає.');
    }

  } catch (error) {
    console.error('Критична помилка виконання:', error);
    res.status(500).send('Сталася помилка під час виконання.');
  }
};
