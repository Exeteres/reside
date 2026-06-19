# API Реплики ключевой ставки

Реплика ключевой ставки получает данные из публичного SOAP API Банка России.
Внутренний NLS-инструмент `get_rate` не использует отдельный скрытый источник данных: он вызывает ту же бизнес-функцию получения ключевой ставки, которая обращается к endpoint Банка России напрямую.

## Источник данных

- Внешний источник: Банк России, сервис `DailyInfoWebServ`.
- Endpoint: `https://www.cbr.ru/DailyInfoWebServ/DailyInfo.asmx`.
- SOAP action: `http://web.cbr.ru/KeyRate`.
- Назначение метода: получение значений ключевой ставки за указанный диапазон дат.

## Формат запроса

Запрос выполняется методом `POST` на endpoint Банка России.
Тело запроса передаётся в формате SOAP XML.
Реплика запрашивает окно от текущей даты минус 30 дней до текущей даты и затем выбирает последнюю запись по полю `DT`.

Обязательные заголовки:

```http
Content-Type: text/xml; charset=utf-8
SOAPAction: "http://web.cbr.ru/KeyRate"
```

Тело запроса:

```xml
<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <KeyRate xmlns="http://web.cbr.ru/">
      <fromDate>2026-05-20T12:00:00.000Z</fromDate>
      <ToDate>2026-06-19T12:00:00.000Z</ToDate>
    </KeyRate>
  </soap:Body>
</soap:Envelope>
```

Поля запроса:

- `fromDate` — начало периода в ISO 8601.
- `ToDate` — конец периода в ISO 8601.

## Формат ответа

Успешный ответ приходит как SOAP XML с результатом `KeyRateResult`.
Внутри payload Банк России возвращает набор строк `KR`.
Реплика ищет в ответе строки, содержащие поля `DT` и `Rate`, независимо от уровня вложенности, и использует строку с самой поздней датой `DT`.

Пример значимой части ответа:

```xml
<KeyRateResponse xmlns="http://web.cbr.ru/">
  <KeyRateResult>
    <diffgr:diffgram xmlns:diffgr="urn:schemas-microsoft-com:xml-diffgram-v1">
      <KeyRate>
        <KR>
          <DT>2026-05-29T00:00:00+03:00</DT>
          <Rate>13.50</Rate>
        </KR>
      </KeyRate>
    </diffgr:diffgram>
  </KeyRateResult>
</KeyRateResponse>
```

Используемые поля ответа:

- `KR` — строка с одним значением ключевой ставки.
- `DT` — дата действия значения ставки; используется для выбора самой свежей строки.
- `Rate` — значение ключевой ставки в процентах; может быть записано с точкой или запятой как десятичным разделителем.

## Формат результата `get_rate`

NLS-инструмент `get_rate` не принимает аргументы.
При успешном получении данных он возвращает объект:

```json
{
  "rate": 13.5,
  "unit": "percent",
  "response": "Current key rate is 13.5%."
}
```

Поля результата:

- `rate` — числовое значение последней найденной ключевой ставки.
- `unit` — единица измерения; всегда `percent`.
- `response` — человекочитаемое сообщение для языкового интерфейса.

Если данные не удалось получить или разобрать, инструмент возвращает объект с полем `response`, содержащим текст ошибки.
