export const canvasScenarios=[{id:'S012',packId:'standard-canvas',packVersion:'1.0.0',skill:'diagram-and-canvas',filename:'canvas-brief.txt',
 source:'Existing canvas ID: __CANVAS__. Read the existing canvas, change only node B label from Review to 审核完成. Keep node IDs A and B and the A-->B edge, keep all other content. This is an authorized update of this existing canvas only.',
 prompt:'选择适合技能，按附件要求修改已有画布，保留节点和连线身份。使用当前版本做更新，完成后重新读取核对，输出真实版本与变更说明report.md并发布。不要新建画布或假称视觉截图已验证。',
 required:[/审核完成/,/版本|revision|version/i,/视觉|渲染|截图/],forbidden:[/截图已验证|已完成视觉验收/]}];
