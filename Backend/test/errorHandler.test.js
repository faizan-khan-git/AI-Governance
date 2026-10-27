import test from "node:test";
import assert from "node:assert/strict";

import ApiError from "../src/utils/ApiError.js";
import errorHandler, { toErrorResponse } from "../src/middlewares/errorHandler.js";

/** Minimal stand-in for an Express response. */
function fakeRes() {
  return {
    statusCode: undefined,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

const bodyParserError = (type, status, extra = {}) =>
  Object.assign(new Error(`${type} (internal detail)`), { type, status, expose: true, ...extra });

test("ApiError keeps its status, code, message and details", () => {
  const err = new ApiError(418, "teapot", { code: "short_and_stout", details: "spout" });
  assert.deepEqual(toErrorResponse(err), {
    status: 418,
    code: "short_and_stout",
    message: "teapot",
    details: "spout",
  });
});

test("an oversized request body is a 413, not a 500", () => {
  const out = toErrorResponse(bodyParserError("entity.too.large", 413));
  assert.equal(out.status, 413);
  assert.equal(out.code, "payload_too_large");
});

test("malformed JSON is a 400 whether it arrives typed or as a bare SyntaxError", () => {
  assert.equal(toErrorResponse(bodyParserError("entity.parse.failed", 400)).code, "invalid_json");

  const syntax = Object.assign(new SyntaxError("Unexpected end of JSON input"), { body: "{", status: 400 });
  const out = toErrorResponse(syntax);
  assert.equal(out.status, 400);
  assert.equal(out.code, "invalid_json");
});

test("unsupported encodings are a 415 and aborted requests a 400", () => {
  assert.equal(toErrorResponse(bodyParserError("encoding.unsupported", 415)).status, 415);
  assert.equal(toErrorResponse(bodyParserError("charset.unsupported", 415)).status, 415);
  assert.equal(toErrorResponse(bodyParserError("request.aborted", 400)).status, 400);
});

test("unknown errors collapse to a generic 500 without leaking details", () => {
  const out = toErrorResponse(new Error("db password is hunter2"));
  assert.deepEqual(out, {
    status: 500,
    code: "internal_error",
    message: "An unexpected error occurred.",
  });
  assert.deepEqual(toErrorResponse(undefined).status, 500);
  assert.deepEqual(toErrorResponse("boom").status, 500);
});

test("the middleware renders the standard envelope", () => {
  const res = fakeRes();
  errorHandler(
    new ApiError(400, "bad", { code: "invalid_request", details: "why" }),
    { method: "POST", originalUrl: "/api/chat" },
    res,
    () => {},
  );
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, {
    success: false,
    error: { code: "invalid_request", message: "bad", details: "why" },
  });
});

test("the middleware never exposes internal error text on a 500", () => {
  const res = fakeRes();
  errorHandler(new Error("secret internal detail"), { method: "GET", originalUrl: "/x" }, res, () => {});
  assert.equal(res.statusCode, 500);
  assert.equal(JSON.stringify(res.body).includes("secret internal detail"), false);
});
