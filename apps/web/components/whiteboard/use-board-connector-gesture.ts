"use client";

import { useEffect, useRef, useState } from "react";
import { connectorLabelPlacement, connectorPathHandles, type ConnectorRelationship, type ConnectorType, type SpatialCommand, type SpatialPrecondition, type WhiteboardObject } from "@repo/whiteboard-core";
import type { BoardViewport } from "./fabric/board-fabric-object";
import type { ConnectorOverlayPointerEvent, ConnectorHandleKind } from "./board-connector-handles";
import { connectorEndpointChange, connectorGestureChange, connectorGestureSnap, connectorRelationshipFromObject, connectorResolvedPath, type ConnectorScenePoint } from "./connector-gesture";

type CaptureTarget = HTMLElement | SVGElement;
interface Gesture {
  pointerId: number;
  target: CaptureTarget;
  id: string;
  creating: boolean;
  kind: ConnectorHandleKind;
  handleId: string | null;
  initial: ConnectorScenePoint;
  current: ConnectorScenePoint;
  before: ConnectorRelationship;
  baseline: string | null;
  originalConnector?: WhiteboardObject["connector"];
  handleOrigin?: ConnectorScenePoint;
  heldSnapTargetId?: string;
  bypass: boolean;
  moved: boolean;
  previewRevision: number;
}
interface Props {
  objects: readonly WhiteboardObject[];
  readLiveObjects?: () => readonly WhiteboardObject[];
  viewport: BoardViewport;
  blocked: boolean;
  selectedId: string | null;
  host: () => HTMLElement | null;
  execute: (command: SpatialCommand, preconditions?: SpatialPrecondition[]) => boolean;
  onCreated: (id: string) => void;
  onFailure: () => void;
}

export function useBoardConnectorGesture(props: Props) {
  const latest = useRef(props); latest.current = props;
  const activeRef = useRef<Gesture | null>(null);
  const spaceHeld = useRef(false);
  const [active, setActive] = useState<Gesture | null>(null);
  const scenePoint = (event: ConnectorOverlayPointerEvent) => {
    const { viewport, host } = latest.current, rect = host()?.getBoundingClientRect();
    if (!rect) return null;
    return { x: (event.clientX - rect.left - viewport.panX) / viewport.zoom, y: (event.clientY - rect.top - viewport.panY) / viewport.zoom };
  };
  const cancel = () => {
    const old = activeRef.current; activeRef.current = null; setActive(null);
    if (old?.target.hasPointerCapture?.(old.pointerId)) old.target.releasePointerCapture(old.pointerId);
  };
  const legal = (gesture: Gesture, objects = latest.current.objects) => {
    const { blocked } = latest.current;
    if (blocked) return false;
    if (!gesture.creating) {
      const edge = objects.find(object => object.id === gesture.id);
      if (!edge || edge.locked || edge.hidden || JSON.stringify(edge.connector) !== gesture.baseline) return false;
    }
    return [gesture.before.from, gesture.before.to].every(id => !id || objects.some(object => object.id === id && !object.locked && !object.hidden));
  };
  const project = (gesture: Gesture, objects = latest.current.objects) => {
    const { viewport } = latest.current;
    const relationship = gesture.creating ? gesture.before : connectorRelationshipFromObject(objects.find(object => object.id === gesture.id)!) ?? gesture.before;
    if (gesture.kind === "from" || gesture.kind === "to") {
      const opposite = gesture.kind === "from" ? relationship.to : relationship.from;
      const snap = connectorGestureSnap(objects, gesture.current, viewport.zoom, [gesture.id, ...(opposite ? [opposite] : [])], gesture.bypass);
      return { relationship: connectorEndpointChange(relationship, gesture.kind, gesture.current, snap), snap };
    }
    const path = connectorResolvedPath(gesture.before, objects);
    const current = gesture.handleOrigin ? { x: gesture.handleOrigin.x + gesture.current.x - gesture.initial.x, y: gesture.handleOrigin.y + gesture.current.y - gesture.initial.y } : gesture.current;
    return { relationship: path ? { ...relationship, ...connectorGestureChange(gesture.before, path, gesture.kind, gesture.handleId, current, gesture.initial) } : relationship, snap: null };
  };
  const begin = (gesture: Gesture, event: ConnectorOverlayPointerEvent) => {
    if (activeRef.current || event.button !== 0 || spaceHeld.current || latest.current.blocked || !legal(gesture)) return;
    event.preventDefault(); event.stopPropagation();
    latest.current.host()?.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture?.(event.pointerId);
    activeRef.current = gesture; setActive(gesture);
  };
  const onPointerDown = (kind: ConnectorHandleKind, handleId: string | null, event: ConnectorOverlayPointerEvent) => {
    const object = latest.current.objects.find(object => object.id === latest.current.selectedId);
    const before = object && connectorRelationshipFromObject(object), point = scenePoint(event);
    if (!before || !point) return;
    const path = connectorResolvedPath(before, latest.current.objects);
    const handleOrigin = path && kind === "route" ? connectorPathHandles(path).find(handle => handle.id === handleId)?.point : path && kind === "label" ? connectorLabelPlacement(path, before.labelPosition).point : undefined;
    begin({ pointerId: event.pointerId, target: event.currentTarget, id: object.id, creating: false, kind, handleId, handleOrigin, initial: point, current: point, before, baseline: JSON.stringify(object.connector), originalConnector: object.connector, bypass: event.metaKey || event.ctrlKey, moved: false, previewRevision: 1 }, event);
  };
  const beginCreation = (before: ConnectorRelationship, event: ConnectorOverlayPointerEvent) => {
    const point = scenePoint(event); if (!point) return;
    begin({ pointerId: event.pointerId, target: event.currentTarget, id: crypto.randomUUID(), creating: true, kind: "to", handleId: null, initial: point, current: point, before, baseline: null, bypass: event.metaKey || event.ctrlKey, moved: false, previewRevision: 1 }, event);
  };
  const beginFreeCreation = (type: ConnectorType, event: ConnectorOverlayPointerEvent) => {
    const point = scenePoint(event); if (!point) return;
    const snap = connectorGestureSnap(latest.current.objects, point, latest.current.viewport.zoom, [], event.metaKey || event.ctrlKey);
    const start = snap?.point ?? point;
    beginCreation({ ...(snap ? { from: snap.objectId } : { fromPoint: start }), toPoint: start, fromAnchor: snap?.anchor ?? "right", toAnchor: "left", type, startStyle: "none", endStyle: "arrow", lineStyle: "solid", label: "", semanticRelation: "" }, event);
  };
  const onPointerMove = (event: ConnectorOverlayPointerEvent) => {
    const gesture = activeRef.current, point = scenePoint(event);
    if (!gesture || event.pointerId !== gesture.pointerId || !point) return;
    event.preventDefault(); event.stopPropagation();
    if (!legal(gesture)) { cancel(); return; }
    const moved = gesture.moved || Math.hypot(point.x - gesture.initial.x, point.y - gesture.initial.y) * latest.current.viewport.zoom >= 3;
    const next = { ...gesture, current: point, moved, bypass: event.metaKey || event.ctrlKey, previewRevision: gesture.previewRevision + 1 };
    next.heldSnapTargetId = project(next).snap?.objectId;
    activeRef.current = next; setActive(next);
  };
  const onPointerUp = (event: ConnectorOverlayPointerEvent) => {
    const gesture = activeRef.current;
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    event.preventDefault(); event.stopPropagation();
    // Fast/coalesced pointer drags can arrive as down → up with no React move.
    // The release coordinate is authoritative for the drag threshold as well.
    const point = scenePoint(event), final = point ? { ...gesture, current: point, bypass: event.metaKey || event.ctrlKey, moved: gesture.moved || Math.hypot(point.x - gesture.initial.x, point.y - gesture.initial.y) * latest.current.viewport.zoom >= 3 } : gesture;
    try {
      // React may not have rendered a remote transaction before this pointer release.
      const liveObjects = latest.current.readLiveObjects?.() ?? latest.current.objects;
      if (!legal(final, liveObjects) || !final.moved) { cancel(); return; }
      if (final.heldSnapTargetId && !liveObjects.some(object => object.id === final.heldSnapTargetId && !object.locked && !object.hidden)) { cancel(); return; }
      const { relationship } = project(final, liveObjects);
      if (![relationship.from, relationship.to].every(id => !id || liveObjects.some(object => object.id === id && !object.locked && !object.hidden))) { cancel(); return; }
      const path = connectorResolvedPath(relationship, liveObjects);
      if (JSON.stringify(relationship) === JSON.stringify(final.before) || (final.creating && (!path || path.length * latest.current.viewport.zoom < 3))) { cancel(); return; }
      cancel();
      const targetIds = new Set([final.before.from, final.before.to, relationship.from, relationship.to].filter((id): id is string => Boolean(id)));
      const preconditions: SpatialPrecondition[] = [...targetIds].map(id => ({ id, locked: false }));
      if (!final.creating) preconditions.push({ id: final.id, locked: false, connector: final.originalConnector });
      const accepted = latest.current.execute({ type: final.creating ? "create-connector" : "update-connector", id: final.id, relationship }, preconditions);
      if (accepted && final.creating) latest.current.onCreated(final.id);
      if (!accepted) latest.current.onFailure();
    } catch { cancel(); latest.current.onFailure(); }
  };
  const onLostPointerCapture = (event?: ConnectorOverlayPointerEvent) => {
    const gesture = activeRef.current;
    // Unrelated Fabric/overlay captures bubble through the editor too.
    if (gesture && (!event || (event.pointerId === gesture.pointerId && event.target === gesture.target))) cancel();
  };
  useEffect(() => {
    const gesture = activeRef.current;
    if (gesture && !legal(gesture)) cancel();
  });
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === " " && !(event.target instanceof Element && event.target.closest("input,textarea,[contenteditable=true]"))) { spaceHeld.current = true; if (activeRef.current) cancel(); }
      if (event.key === "Escape" && activeRef.current) { event.preventDefault(); cancel(); }
    };
    const keyup = (event: KeyboardEvent) => { if (event.key === " ") spaceHeld.current = false; };
    const blur = () => { spaceHeld.current = false; cancel(); };
    window.addEventListener("keydown", keydown);
    window.addEventListener("keyup", keyup); window.addEventListener("blur", blur);
    return () => { window.removeEventListener("keydown", keydown); window.removeEventListener("keyup", keyup); window.removeEventListener("blur", blur); const old = activeRef.current; activeRef.current = null; if (old?.target.hasPointerCapture?.(old.pointerId)) old.target.releasePointerCapture(old.pointerId); };
  }, []);
  const projected = active && legal(active) ? project(active) : null;
  const candidateObject = projected?.snap ? props.objects.find(object => object.id === projected.snap!.objectId) : null;
  return { active: Boolean(active), creating: Boolean(active?.creating), id: active?.id ?? null, previewRevision: active?.previewRevision ?? 0, relationship: projected?.relationship ?? null, path: projected ? connectorResolvedPath(projected.relationship, props.objects) : null, snapCandidate: candidateObject ? { id: candidateObject.id, geometry: candidateObject.geometry } : null, beginCreation, beginFreeCreation, onPointerDown, onPointerMove, onPointerUp, onPointerCancel: cancel, onLostPointerCapture, cancel };
}
