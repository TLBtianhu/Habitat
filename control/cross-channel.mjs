// Owner-approved cross-channel message execution: policy revalidation + idempotent outbox.
import { DurableOutbox } from '../agent/durable-outbox.mjs';
import { AfterActionStore } from '../agent/after-action.mjs';

export class CrossChannelTasks {
  constructor({ policy, onebotClient, outbox = null, outboxFile = '/var/lib/habitat/outbox/control-tasks.json', afterAction = null }) {
    this.policy = policy;
    this.onebotClient = onebotClient;
    this.outbox = outbox || new DurableOutbox({ file: outboxFile });
    this.afterAction = afterAction || new AfterActionStore();
  }

  async execute(task) {
    const key = `cross_channel:${task.id}`;
    const existing = this.outbox.get(key);
    if (existing) {
      if (existing.state === 'succeeded') return { ...existing.result, deduped: true };
      if (existing.state === 'failed' || existing.state === 'interrupted') {
        return { ok: false, state: existing.state, error: existing.error, accepted: true, deduped: true };
      }
      return { ok: false, state: existing.state, error: 'in_progress', accepted: true, deduped: true };
    }
    try {
      const decision = this.policy.authorizeCrossChannel(task);
      const result = await this.outbox.execute({
        key,
        verb: task.type,
        args: { targetResidenceId: task.targetResidenceId },
        timeoutMs: 10000,
        run: async () => {
          const result = decision.kind === 'group'
            ? await this.onebotClient.sendGroupMsg(Number(decision.peerId), task.text)
            : await this.onebotClient.sendPrivateMsg(Number(decision.peerId), task.text);
          this.policy.noteOutput(decision.targetResidenceId);
          return { ...result, targetResidenceId: decision.targetResidenceId };
        },
      });
      this.afterAction.record({
        taskId: task.id,
        residenceId: decision.targetResidenceId,
        goal: `cross_channel.message to ${decision.targetResidenceId}`,
        selfReport: task.selfReport || null,
        checks: [
          { name: 'target_residence_matches', ok: result.targetResidenceId === task.targetResidenceId, evidence: result.targetResidenceId },
          { name: 'message_accepted', ok: Boolean(result.message_id), evidence: result.message_id || null },
          { name: 'outbox_terminal_success', ok: true, evidence: 'succeeded' },
        ],
      });
      return result;
    } catch (error) {
      this.afterAction.record({
        taskId: task.id,
        residenceId: task.targetResidenceId,
        goal: `cross_channel.message to ${task.targetResidenceId}`,
        selfReport: task.selfReport || null,
        checks: [{ name: 'execution_failed', ok: false, evidence: error.message }],
      });
      throw error;
    }
  }
}
