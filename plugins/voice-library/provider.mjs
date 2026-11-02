export function createHandlers({ systemChat, voice }) {
  return {
    speak: async (args) => {
      const message = args.messageId ? null : await systemChat.say(args.text);
      const messageId = args.messageId || message.id;
      try {
        const utterance = await voice.speak({
          messageId,
          voiceProfile: args.voiceProfile || null,
          delivery: args.delivery || ['console'],
          priority: args.priority || 'normal',
        });
        return { message, utterance };
      } catch (e) {
        return { message, voiceError: e.message };
      }
    },
  };
}
