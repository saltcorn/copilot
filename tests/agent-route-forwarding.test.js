const {
  AGENT_CHAT_ROUTE_NAMES,
  buildAgentRouteForwarders,
} = require("../agent-route-forwarding");

describe("Saltcorn Agent copilot route forwarding", () => {
  test("exposes every route used by the embedded Agent Chat view", () => {
    expect(AGENT_CHAT_ROUTE_NAMES).toEqual([
      "interact",
      "delprevrun",
      "debug_info",
      "skillroute",
      "execute_user_action",
      "cancel",
      "tts",
      "share_chat",
      "renameprevrun",
    ]);

    const routes = buildAgentRouteForwarders(() => ({ runRoute: jest.fn() }));
    expect(Object.keys(routes)).toEqual(AGENT_CHAT_ROUTE_NAMES);
    AGENT_CHAT_ROUTE_NAMES.forEach((route) =>
      expect(typeof routes[route]).toBe("function"),
    );
  });

  test.each(AGENT_CHAT_ROUTE_NAMES)(
    "forwards %s to a fresh embedded Agent Chat view",
    async (route) => {
      const result = { route };
      const runRoute = jest.fn().mockResolvedValue(result);
      const getAgentView = jest.fn(() => ({ runRoute }));
      const routes = buildAgentRouteForwarders(getAgentView);
      const body = { run_id: 32 };
      const reqres = { req: { user: { id: 1 } }, res: { headersSent: false } };

      await expect(
        routes[route](null, "Saltcorn Agent copilot", {}, body, reqres),
      ).resolves.toBe(result);
      expect(getAgentView).toHaveBeenCalledTimes(1);
      expect(runRoute).toHaveBeenCalledWith(route, body, reqres.res, reqres);
    },
  );
});
