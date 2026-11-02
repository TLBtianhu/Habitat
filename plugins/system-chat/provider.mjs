export function createHandlers({ systemChat }) {
  return {
    say: (args) => systemChat.say(args.text),
  };
}
