/**
 * ExpandResumePriorUser：若 message 以特殊续跑标记开头，则从 session 历史拼回 prior user。
 * 简化实现：当前透传；保留扩展点与 Go resume_prior_user 对齐。
 */
export function expandResumePriorUser(message: string, _priorUsers: string[] = []): string {
  const marker = '<<RESUME_PRIOR_USER>>';
  if (!message.includes(marker)) {
    return message;
  }
  // 完整 prior 拼接可在接入 FileSession ledger 后补齐
  return message.replaceAll(marker, '').trim();
}
