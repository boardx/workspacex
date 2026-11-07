import {createHash} from "node:crypto";
/** Disposable acceptance identity, distinct from every other lane. Never production seed data. */
const scope=(process.env.WORKSPACEX_ISOLATION_ID??"missing").replace(/[^a-zA-Z0-9-]/g,"-").slice(-20);
const credential=(purpose:string)=>createHash("sha256").update(`${process.env.WORKSPACEX_ISOLATION_ID??"missing"}:${purpose}`).digest("hex");
export const enterpriseAcceptance={
 source:`enterprise-browser-source-${scope}`,target:`enterprise-browser-target-${scope}`,
 operator:`enterprise-browser-operator-${scope}`,admin:`enterprise-browser-admin-${scope}`,
 operatorEmail:`enterprise-operator-${scope}@example.test`,adminEmail:`enterprise-admin-${scope}@example.test`,
 password:credential("enterprise-browser-login"),catalogUser:"enterprise_catalog_6108",catalogPassword:credential("enterprise-catalog-login"),
};
