import Elysia from "elysia";
import { z } from "zod";

function parseConfig() {
  const zNumber = z
    .string()
    .default("3000")
    .transform((val, ctx) => {
      const parsed = parseInt(val);
      if (isNaN(parsed)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Not a number",
        });
        return z.NEVER;
      }
      return parsed;
    });

  const zConfig = z.object({
    PORT: zNumber,
  });
  const config = zConfig.parse(process.env);
  return config;
}

const config = parseConfig();

class ApolloClient {
  constructor() {}

  async enrichPeople(body: unknown, headers?: Record<string, string>) {
    const resp = await fetch("https://api.apollo.io/v1/people/match", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
    return resp;
  }
}

const zObject = z.object({}).passthrough();
const zEnrichPeopleResponse = z.object({
  person: z.object({
    phone_numbers: z.array(
      z.object({
        sanitized_number: z.string(),
      })
    ),
  }),
});

const apollo = new ApolloClient();

function extractHeaders(res: Response) {
  const ret: Record<string, string> = {};
  for (const [k, v] of res.headers) {
    if (k.toLowerCase().startsWith("x-") || k == "Content-Type") {
      ret[k] = v;
    }
  }
  return ret;
}

function proxyResponse(
  res: Response,
  { body, json }: { body?: string | ArrayBuffer; json?: unknown }
) {
  const proxyBody = json != null ? JSON.stringify(json) : body;
  return new Response(proxyBody, {
    status: res.status,
    statusText: res.statusText,
    headers: { ...extractHeaders(res), "x-tierpeak-apollo-middleman": "1" },
  });
}

const server = new Elysia()
  .post("/v1/people/match", async (r) => {
    const res = await apollo.enrichPeople(r.body);
    if (!res.ok) {
      return proxyResponse(res, { body: await res.arrayBuffer() });
    }

    const dataText = await res.text();
    try {
      const dataJson = JSON.parse(dataText);
      const dataJsonPretty = JSON.stringify(dataJson, null, 4);

      const dataObj = zObject.parse(dataJson);
      let phone = "";
      const parsed = zEnrichPeopleResponse.safeParse(dataJson);
      if (parsed.success) {
        phone = parsed.data.person.phone_numbers.at(0)?.sanitized_number ?? "";
      }

      const extra = {
        response: dataJsonPretty,
        phone,
      };
      return proxyResponse(res, { json: { ...dataObj, extra } });
    } catch (error) {
      return proxyResponse(res, { body: dataText });
    }
  })
  .listen(config.PORT);

console.info(`Serving http://localhost:${server.server?.port}`);
