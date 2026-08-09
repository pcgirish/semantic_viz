import { describe, expect, it } from "vitest";
import Parser from "tree-sitter";
import { createRequire } from "node:module";
import { walkPythonFile } from "../src/walk-python.js";
import type { DiRouterFact, Fact, RouteRegistrationFact } from "../src/facts.js";

const require = createRequire(import.meta.url);
const Python = require("tree-sitter-python") as unknown;

function pyFacts(src: string): Fact[] {
  const parser = new Parser();
  parser.setLanguage(Python as Parser.Language);
  return walkPythonFile(parser.parse(src), src, "f.py");
}

function diRouters(facts: Fact[]): DiRouterFact[] {
  return facts.filter((f): f is DiRouterFact => f.kind === "di_router");
}
function routeRegistrations(facts: Fact[]): RouteRegistrationFact[] {
  return facts.filter((f): f is RouteRegistrationFact => f.kind === "route_registration");
}

describe("DI router extraction — Python", () => {
  it("captures dependencies=[Depends(x), Depends(y(...))] on an APIRouter(...) assignment", () => {
    const facts = pyFacts(`
public = APIRouter(prefix="/public",
                   dependencies=[Depends(rate_limit("public")), Depends(verify_token)])
`);
    const routers = diRouters(facts);
    expect(routers).toHaveLength(1);
    expect(routers[0]!.routerVar).toBe("public");
    expect(routers[0]!.dependencies).toEqual(["rate_limit", "verify_token"]);
  });

  it("ignores an APIRouter(...) with no dependencies kwarg", () => {
    const facts = pyFacts(`admin = APIRouter(prefix="/admin")`);
    expect(diRouters(facts)).toHaveLength(0);
  });
});

describe("route registration extraction — Python", () => {
  it("captures call-form registration: router.post(path)(handler)", () => {
    const facts = pyFacts(`public.post("/orders")(orders.create_order.create_order)`);
    const regs = routeRegistrations(facts);
    expect(regs).toHaveLength(1);
    expect(regs[0]!.routerVar).toBe("public");
    expect(regs[0]!.handlerName).toBe("orders.create_order.create_order");
  });

  it("captures decorator-form registration: @router.get(path) above a def", () => {
    const facts = pyFacts(`
@public.get("/orders/{order_id}")
def get_order(order_id):
    pass
`);
    const regs = routeRegistrations(facts);
    expect(regs).toHaveLength(1);
    expect(regs[0]!.routerVar).toBe("public");
    expect(regs[0]!.handlerName).toBe("get_order");
  });
});
