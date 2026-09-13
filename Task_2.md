# Task 2: Debug

The supplied Zapier Code step is intended to POST a lead to the Further API, but there are several issues that explain both symptoms:

- the lead is not created in Further, and
- Zapier still shows the step as successful.

## Bugs Found

### 1. The endpoint is wrong

The code posts to:

```text
https://api.talkfurther.com/leads
```

The challenge specifies:

```text
https://api.talkfurther.com/api/chat/leads/ingestion/zapier-webhook
```

Even a correctly constructed request would be sent to the wrong route.

---

### 2. The request uses the wrong content type

The code sends:

```js
'Content-Type': 'application/json'
```

The Further endpoint expects:

```text
multipart/form-data
```

The request therefore does not match the API contract.

---

### 3. A plain JavaScript object is passed directly as the request body

The code uses:

```js
body: payload
```

`fetch()` does not automatically serialize a plain JavaScript object into JSON or multipart form data.

If this were a JSON API, the body would at least need to be serialized with `JSON.stringify(payload)`. However, that still would not fix this integration because this endpoint expects multipart form data.

---

### 4. The request never constructs the required multipart body

The fields should be placed into a `FormData` object:

```js
const form = new FormData();

form.append('community_id', inputData.communityId);
form.append('first_name', inputData.first);
form.append('last_name', inputData.last);
form.append('email', inputData.emailAddress);
form.append('phone', inputData.phoneNumber);
```

This is separate from the incorrect `Content-Type` header: the payload itself is also being constructed in the wrong representation.

---

### 5. The code never checks the HTTP status

This is the main reason the Zap can show a green checkmark even though no lead was created.

`fetch()` does not throw just because an HTTP server returns an error status such as:

```text
400
401
404
500
```

The promise still resolves with a `Response` object.

The code needs to explicitly check:

```js
if (!response.ok) {
  throw new Error(...);
}
```

Without that check, Zapier sees the Code step finish normally and treats it as a successful run.

**An HTTP request completing is not the same thing as the HTTP request succeeding.**

---

### 6. The code expects a `success` field that Further does not return

The code does:

```js
return { success: result.success };
```

A successful Further response contains fields such as:

```json
{
  "further_lead_id": 1234567,
  "external_lead_id": null,
  "community_code": "Your Community"
}
```

There is no documented `success` property.

So even a successful response would make:

```js
result.success
```

evaluate to `undefined`.

---

### 7. Returning `{ success: false }` would still not make the Zap fail

Even if the API returned a value that caused this:

```js
return { success: false };
```

Zapier would still see that as a successfully completed Code step.

Zapier does not interpret an arbitrary property named `success` as the execution status. To make the step fail, the code must actually throw an error.

---

### 8. The code assumes every response body is valid JSON

The code immediately does:

```js
const result = await response.json();
```

That can fail if an upstream service, proxy, or error page returns:

- plain text,
- HTML, or
- an empty body.

Defensive integration code should preserve the HTTP status and raw response even when the body cannot be parsed as JSON.

---

### 9. API error details are discarded

Further can return useful validation errors, for example:

```json
{
  "email": "Invalid email address."
}
```

The current code never checks the failed HTTP status and therefore does not surface the error in a useful way.

A better error would be something like:

```text
Further API returned 400: {"email":"Invalid email address."}
```

That makes support and troubleshooting much easier.

---

### 10. Required Zap inputs are not validated before the API call

The Further endpoint requires:

- `community_id`
- `first_name`
- `last_name`
- `email`
- `phone`

The code assumes the corresponding Zapier input values are always present.

The variable names themselves are not necessarily wrong:

```js
inputData.communityId
inputData.first
inputData.last
inputData.emailAddress
inputData.phoneNumber
```

Those can be valid custom names in Zapier's Input Data configuration.

The issue is that the code does not verify that those values are present and non-empty before making the API request.

For example:

```js
if (!inputData.emailAddress) {
  throw new Error('Missing required input: emailAddress');
}
```

---

## What Is Not a Bug

The authorization header shown in the sample is valid:

```js
'Authorization': 'Api-Key ' + inputData.apiKey
```

I confirmed that format against the live Further endpoint during testing.

I also would not treat the following as bugs without additional evidence:

- `community_id` being passed as a string in multipart form data
- the custom `inputData` property names themselves
- the absence of an `Accept: application/json` header

Those may all be valid depending on the Zap configuration and API behavior.

---

## Corrected Version

```js
const requiredInputs = {
  communityId: inputData.communityId,
  first: inputData.first,
  last: inputData.last,
  emailAddress: inputData.emailAddress,
  phoneNumber: inputData.phoneNumber,
  apiKey: inputData.apiKey
};

const missing = Object.entries(requiredInputs)
  .filter(([, value]) =>
    value === undefined ||
    value === null ||
    String(value).trim() === ''
  )
  .map(([key]) => key);

if (missing.length > 0) {
  throw new Error(
    `Missing required input(s): ${missing.join(', ')}`
  );
}

const form = new FormData();

form.append('community_id', String(inputData.communityId));
form.append('first_name', String(inputData.first).trim());
form.append('last_name', String(inputData.last).trim());
form.append('email', String(inputData.emailAddress).trim());
form.append('phone', String(inputData.phoneNumber).trim());

const response = await fetch(
  'https://api.talkfurther.com/api/chat/leads/ingestion/zapier-webhook',
  {
    method: 'POST',
    headers: {
      'Authorization': `Api-Key ${inputData.apiKey}`
    },
    body: form
  }
);

const rawBody = await response.text();

let result;

try {
  result = rawBody ? JSON.parse(rawBody) : {};
} catch {
  result = { raw_response: rawBody };
}

if (!response.ok) {
  throw new Error(
    `Further API request failed (${response.status} ${response.statusText}): ${rawBody}`
  );
}

if (!result.further_lead_id) {
  throw new Error(
    `Further returned a successful HTTP status but no further_lead_id: ${rawBody}`
  );
}

return {
  further_lead_id: result.further_lead_id,
  external_lead_id: result.external_lead_id,
  community_code: result.community_code
};
```

### Important multipart detail

When using `FormData`, I would **not** manually set:

```js
'Content-Type': 'multipart/form-data'
```

`fetch()` generates the multipart boundary automatically, producing a header similar to:

```text
multipart/form-data; boundary=----formdata-undici-...
```

Hardcoding only `multipart/form-data` can prevent the server from parsing the request correctly because the boundary would be missing.

---

## Root Cause Summary

The lead is not created because the code is sending the wrong request to the wrong endpoint: it targets `/leads`, declares a JSON payload even though the endpoint requires multipart form data, and passes a plain JavaScript object directly as the request body.

Separately, the reason Zapier reports a green run is that `fetch()` does not throw on HTTP error responses and the code never checks `response.ok`. Responses such as HTTP 400 or 404 are therefore treated as normal code execution.

Finally, the code expects a `success` field that is not part of Further's documented success response.

In short:

- **Why is there no lead?** The API request is constructed incorrectly.
- **Why is the Zap green?** The code does not treat HTTP failures as execution failures.

---

## Additional Edge Case: Retries and Duplicate Leads

One additional edge case I would handle is duplicate creation caused by retries.

For example:

1. Zapier sends the request.
2. Further successfully creates the lead.
3. The network connection fails before Zapier receives the response.
4. Zapier treats the run as failed or timed out.
5. The step is retried.
6. The same lead may be created a second time.

In production, I would check whether Further supports an idempotency key or external lead identifier and use it to make retries safe. If not, I would add duplicate-detection or reconciliation logic around the integration.
