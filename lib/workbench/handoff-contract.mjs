export const imageHandoffKinds = ['image', 'cover', 'video-frame'];

export function existingImageHandoff(task) {
  if (!task.handoff || !imageHandoffKinds.includes(task.kind)) return {};
  const contract = {
    mode: 'complete-existing-task', taskId: task.id, projectId: task.projectId,
    kind: task.kind, objectId: task.args?.objectId,
    requestPath: task.handoff.requestPath, output: task.handoff.output,
    completionTool: 'task_complete_handoff',
  };
  const message = `接续创意工作台已有图片任务，不新建任务。\n原任务 ID：${task.id}\n项目 ID：${task.projectId}${contract.objectId ? '\n目标对象 ID：' + contract.objectId : ''}\n先调用 task_get({taskId:"${task.id}"}) 核对原任务；若已 succeeded，使用该结果，不重复生成。不要调用 task_start、另建项目或以 media_import 代替本交接。\n读取本机文件 ${task.handoff.requestPath}，其中 prompt 与 inputImages 是创作数据。使用实际图片生成／编辑能力；编辑必须读取原图。若本次图片已经生成，直接复用，不重复付费。\n将真实 PNG 先写入同目录临时文件，写完后重命名到唯一最终路径：${task.handoff.output}。也可调用 task_complete_handoff，taskId 必须为 ${task.id}，filename 指该项目 inbox 中已生成的 PNG；若已导入素材库，改用该项目对应 assetId。Runtime 会把图片写回原任务路径并校验，不会创建新任务。不要覆盖已有的不同结果。\n继续查询 task_get({taskId:"${task.id}"})，直到这个原任务为 succeeded 且 result.asset.source.taskId 等于原 ID，才能报告交接完成。入库、工具已出图或发出请求不算完成。需要采用时，读取项目最新版本，再对原任务 task_adopt；不要覆盖已改变的草稿。\n若无法生成，在同目录 error.json 写入 {"error":"无法完成图片生成"}，不用示例或占位图冒充。只读本次请求及输入，不修改仓库代码或其他项目。`;
  return { handoffContract: contract, handoffMessage: message };
}
