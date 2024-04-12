import json
import logging
from typing import Mapping
import fastapi
import httpx
import pydantic

logger = logging.getLogger(__name__)


class ApolloClient:
    def __init__(self) -> None:
        self._client = httpx.AsyncClient()

    async def enrich(self, body: bytes, headers: Mapping[str, str]) -> httpx.Response:
        res = await self._client.request(
            "POST",
            "https://api.apollo.io/v1/people/match",
            content=body,
            headers={"Content-Type": "application/json"},
            # headers=headers,
        )
        print(body, headers, res)
        return res


apollo = ApolloClient()

app = fastapi.FastAPI()


def proxy_response(res: httpx.Response, *, content: str) -> fastapi.Response:
    headers = {
        k: v
        for k, v in res.headers.items()
        if k.lower().startswith("x-") or k.lower() == "content-type"
    }
    headers["x-tierpeak-apollo-middleman"] = "1"
    return fastapi.Response(
        status_code=res.status_code,
        headers=headers,
        content=content,
    )


class PhoneNumber(pydantic.BaseModel):
    sanitized_number: str


class Person(pydantic.BaseModel):
    phone_numbers: list[PhoneNumber]


class EnrichResponse(pydantic.BaseModel):
    model_config = pydantic.ConfigDict(extra="allow")

    person: Person


@app.post("/v1/people/match")
async def people_match(req: fastapi.Request) -> fastapi.Response:
    req_body = await req.body()
    apollo_res = await apollo.enrich(req_body, headers=req.headers)
    res_body_raw = apollo_res.text

    if apollo_res.status_code != httpx.codes.OK:
        return proxy_response(apollo_res, content=res_body_raw)

    try:
        res_body_json = json.loads(res_body_raw)
        res_body = EnrichResponse.model_validate(res_body_json)
    except Exception as exc:
        logger.error("Failed to parse response", exc_info=exc)
        return proxy_response(apollo_res, content=res_body_raw)

    phone_number = next(iter(res_body.person.phone_numbers), None)
    res_body_pretty = json.dumps(res_body_json, indent=4)
    extra = dict(
        phone_number=phone_number.sanitized_number if phone_number else "",
        response=res_body_pretty,
    )
    res_body_json["extra"] = extra

    return proxy_response(apollo_res, content=json.dumps(res_body_json))
