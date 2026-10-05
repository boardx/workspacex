import {describe,it,expect} from "vitest";
import {modelTestAmountToMicros,modelTestMicrosToAmount} from "@/lib/model-test-money";
describe("exact model test currency amount conversion",()=>{
 it.each([["0.000001","1"],["0.1","100000"],["1","1000000"],["1.234567","1234567"],["9223372036854.775807","9223372036854775807"]])("converts %s without floating point",(amount,micros)=>{expect(modelTestAmountToMicros(amount)).toBe(micros);expect(modelTestMicrosToAmount(micros)).toBe(amount);});
 it.each(["","0","0.000000","0.0000001","1.2345678","1e3","1,000","-1","+1","01",".1","1.","9223372036854.775808","9999999999999"])("rejects invalid or overflowing authorized amount %j",amount=>expect(modelTestAmountToMicros(amount)).toBe(null));
 it("formats known zero usage but never authorizes a zero budget",()=>{expect(modelTestMicrosToAmount("0")).toBe("0");expect(modelTestAmountToMicros("0")).toBe(null);expect(modelTestMicrosToAmount("1")).toBe("0.000001");expect(modelTestMicrosToAmount("1234000")).toBe("1.234");expect(modelTestMicrosToAmount("-1")).toBe(null);});
});
