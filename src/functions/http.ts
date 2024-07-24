import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";

async function enrich(body: ArrayBuffer) {
  const res = await fetch("https://api.apollo.io/v1/people/match", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  return res;
}

function normalizePhoneNumber(n: string): string {
  return n.replace(/^\+1/, "");
}

function proxyResponse(
  res: Response,
  content: string | ArrayBuffer
): HttpResponseInit {
  const headers: Record<string, string> = {};
  for (const [k, v] of res.headers) {
    if (k.toLowerCase().startsWith("x-") || k.toLowerCase() == "content-type") {
      headers[k] = v;
    }
  }
  headers["x-tierpeak-apollo-middleman"] = "1";
  return {
    status: res.status,
    headers,
    body: content,
  };
}

type EnrichResponse = {
  person: {
    phone_numbers?: Array<{ sanitized_number: string }>;
  };
};

export async function http(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  context.log(`Http function processed request for url "${request.url}"`);

  const reqBody = await request.arrayBuffer();
  const res = await enrich(reqBody);

  const resText = await res.text();
  if (!res.ok) {
    return proxyResponse(res, resText);
  }

  try {
    const resBodyJson = JSON.parse(resText) as EnrichResponse;
    const resBodyPretty = JSON.stringify(resBodyJson, null, 4);
    const phoneNumber =
      resBodyJson.person.phone_numbers?.at(0)?.sanitized_number;
    const extra = {
      phoneNumber: phoneNumber && normalizePhoneNumber(phoneNumber),
      response: resBodyPretty,
    };
    const resBodyAugmented = JSON.stringify({ ...resBodyJson, extra });
    return proxyResponse(res, resBodyAugmented);
  } catch (error) {
    console.error("Failed to transform response", error);
    return proxyResponse(res, resText);
  }
}

app.http("http", {
  methods: ["GET", "POST"],
  authLevel: "anonymous",
  handler: http,
});
