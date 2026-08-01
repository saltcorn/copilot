const AGENT_CHAT_ROUTE_NAMES = [
  "interact",
  "delprevrun",
  "debug_info",
  "skillroute",
  "execute_user_action",
  "cancel",
  "tts",
  "share_chat",
  "renameprevrun",
];

const buildAgentRouteForwarders = (getAgentView) =>
  Object.fromEntries(
    AGENT_CHAT_ROUTE_NAMES.map((route) => [
      route,
      async (tableId, viewname, configuration, body, reqres) => {
        const view = getAgentView();
        return await view.runRoute(route, body, reqres.res, reqres);
      },
    ]),
  );

module.exports = { AGENT_CHAT_ROUTE_NAMES, buildAgentRouteForwarders };
