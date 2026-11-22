"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import { listMyProjects, uploadRefImage, PROTOTYPE_MAX_REF_IMAGES, type DesignProject } from "@/lib/live-design-workbench";
import { loadAidtDesignHandoff, type AidtDesignHandoff, type AidtDesignHandoffInput } from "../lib/aidt-design-handoff";
import { readAidtStage } from "../lib/live-aidt-stages";
import { readAidtPrototypeEntityDraft } from "../lib/aidt-prototype-handoff";
import { aidtDesignSourceImages, assertAidtSourceImageCapacity, assertAidtSourceImageSelection, readAidtSourceImageBytes, readAidtSourceImageBinding,
  aidtNativeSourceImageMatches, aidtSourceImageMatches, readRetainedAidtSourceImageBinding, saveAidtSourceImageReceipts, type SourceImageBinding } from "../lib/aidt-prototype-source-images";
import { AidtResearchMaterialPreview } from "./aidt-research-material";

type Props = { input: AidtDesignHandoffInput; handoff: AidtDesignHandoff; project: DesignProject; disabled: boolean; onProjectUpdated: (project: DesignProject) => void };
/** Explicitly imports the exact authorized frozen image bytes into native Design. */
export function AidtPrototypeSourceImages({input,handoff,project,disabled,onProjectUpdated}:Props) {
  const identity = JSON.stringify([input.projectId,input.stageId,input.sessionToken,input.prototypeEntityId,input.roundRevision,project.id,handoff.offer.id,handoff.sourceImages]);
  const current = React.useRef(identity); current.current = identity;
  const pending = React.useRef<SourceImageBinding[]>([]), unknown = React.useRef(false), cancel = React.useRef<AbortController | null>(null);
  const [busy,setBusy] = React.useState(false),[notice,setNotice] = React.useState("");
  React.useEffect(() => { current.current=identity;pending.current=[];unknown.current=false;setBusy(false);setNotice("");return () => {cancel.current?.abort();current.current="unmounted";}; },[identity]);
  const sources = aidtDesignSourceImages(handoff);
  const historical = input.stageId !== 5 || input.roundRevision !== undefined;
  async function importImages() {
    if (busy || disabled || historical || unknown.current) return;
    const controller = new AbortController();cancel.current=controller;
    const expected=identity, context={...input,signal:controller.signal};
    const check=() => {if(controller.signal.aborted || current.current!==expected) throw new Error("来源或账户已变化，已停止继续导入。");};
    setBusy(true);setNotice("");
    try {
      const fresh=await loadAidtDesignHandoff(context);check();
      if(fresh.offer.id!==handoff.offer.id || fresh.offer.text!==handoff.offer.text || JSON.stringify(fresh.sourceImages)!==JSON.stringify(handoff.sourceImages)) throw new Error("文字设计或冻结图片来源已变化，请重新读取。");
      const selected=assertAidtSourceImageCapacity(fresh);
      // Each selected artifact has its own authorization even when identical bytes deduplicate into one native reference.
      for(const source of fresh.sourceImages ?? []) {await readAidtSourceImageBytes(context,source);check();}
      const {stage}=await readAidtStage(input.projectId,5,input.sessionToken,controller.signal);check();
      const original=stage && readAidtPrototypeEntityDraft(stage.content.draft,project.id);
      assertAidtSourceImageSelection(original ?? null, fresh);
      const old=readAidtSourceImageBinding(original,fresh);
      let savedReceiptsKey=old ? JSON.stringify(old.images) : "";
      let native=(await listMyProjects()).items.find(item=>item.id===project.id);check();
      if(!native) throw new Error("当前无权读取原生 Design，未导入图片。");
      const retained = old ?? readRetainedAidtSourceImageBinding(original ?? null, fresh, native);
      const receipts=[...(retained?.images??[]),...pending.current].filter((image,index,all)=>all.findIndex(value=>value.nativeImageId===image.nativeImageId)===index)
        .filter(image=>selected.some(source=>aidtSourceImageMatches(image,source)) && aidtNativeSourceImageMatches(image,native!));
      for(const source of selected) {
        check();
        const actual=await readAidtSourceImageBytes(context,source);check();
        if(receipts.some(image=>aidtSourceImageMatches(image,source))) continue;
        if(native.refImages.length>=PROTOTYPE_MAX_REF_IMAGES) throw new Error("原生参考图位置已满。请核对现有参考图，不能覆盖或偷偷丢掉来源图。");
        const extension=actual.reference.mime==="image/png"?"png":actual.reference.mime==="image/jpeg"?"jpg":"webp";
        const filename=`aidt-source-${actual.reference.sha256}.${extension}`;
        if(native.refImages.some(image=>image.name===filename)) throw new Error("发现同名但未保存关联回执的参考图。请在原生参考图中核对或移除，未重复上传，也未仅凭文件名采用。");
        const file=new File([actual.blob],filename,{type:actual.reference.mime});
        unknown.current=true;
        let uploaded;
        try {uploaded=await uploadRefImage(project.id,file,{sessionToken:input.sessionToken,signal:controller.signal});}
        catch(cause) {if(cause instanceof ApiError && [400,401,403,404,409,413,415,422].includes(cause.status)) unknown.current=false;throw cause;}
        unknown.current=false;check();
        if(uploaded.project.id!==project.id || !uploaded.project.refImages.some(image=>image.id===uploaded.image.id)
          || uploaded.image.name!==filename || uploaded.image.size!==actual.reference.bytes || uploaded.image.mime!==actual.reference.mime) throw new Error("原生上传回执与本次原件不一致，未保存来源关联。");
        native=uploaded.project;
        const receipt:SourceImageBinding={sourceRunId:source.reference.runId,artifactId:source.reference.artifactId,versionId:source.reference.versionId,sha256:source.reference.sha256,
          stage4Revision:source.stage4Revision,brainstormId:source.brainstormId,nativeImageId:uploaded.image.id,nativeName:uploaded.image.name,nativeSize:uploaded.image.size,nativeMime:uploaded.image.mime};
        receipts.push(receipt);pending.current=[...receipts];onProjectUpdated(native);
        await saveAidtSourceImageReceipts(context,fresh,receipts);check();savedReceiptsKey=JSON.stringify(receipts);
      }
      if(savedReceiptsKey!==JSON.stringify(receipts)) {await saveAidtSourceImageReceipts(context,fresh,receipts);check();}
      pending.current=[];onProjectUpdated(native);setNotice(`已载入并保存 ${selected.length} 张冻结来源图；实际模型发送仍由你明确操作。`);
    } catch(cause) {
      if(current.current===expected) setNotice(unknown.current ? "本次上传结果尚不确定。请先在原生参考图中核对，不会自动重传。" : cause instanceof Error?cause.message:"来源图片导入未完成，已知上传回执保留，可核对后继续。");
    } finally {if(cancel.current===controller) {cancel.current=null;if(current.current===expected)setBusy(false);}controller.abort();}
  }
  return <section aria-label="冻结点子图片来源" className="mx-3 mb-2 space-y-2 rounded-lg border border-border p-3 text-12">
    <p>第4步的描述单图片会作为原生 Design 参考图。先查看，再明确载入；不会静默上传或调用模型。</p>
    {sources.map(source=><details key={source.reference.sha256}><summary>{source.title} · 第4步 V{source.stage4Revision}</summary><AidtResearchMaterialPreview projectId={input.projectId} reference={source.reference} alt={`${source.title} 的冻结描述单图片`} /></details>)}
    {sources.length>PROTOTYPE_MAX_REF_IMAGES && <p role="status">当前原生 Design 最多接收 {PROTOTYPE_MAX_REF_IMAGES} 张不同参考图，请拆分制作；这里保留全部来源可查看。</p>}
    {historical && <p role="status">当前为冻结历史来源，仅可查看；请在当前第5步确认文字设计后载入参考图。</p>}
    {!sources.length && <p role="status">冻结图片来源缺失，未以文字或其他图片替代。</p>}
    <Button type="button" variant="outline" size="sm" disabled={disabled||historical||busy||unknown.current||!sources.length||sources.length>PROTOTYPE_MAX_REF_IMAGES} onClick={()=>void importImages()}>{busy?"正在核对并载入…":"载入冻结点子图片"}</Button>
    {notice && <p role="status">{notice}</p>}
  </section>;
}
