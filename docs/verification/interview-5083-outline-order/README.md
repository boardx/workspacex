# #5083 Expert outline reorder

Real browser acceptance found that moving the final expert group before the first concatenated its last question with the next heading, collapsing two expert groups into one. The final generated subtree had no trailing newline. The original corruption was not saved; refresh restored the persisted outline.

Fix: retain subtree bytes and insert only a required LF/CRLF separator when the moved subtree does not end with a newline. Tests exercise both up/down and LF/CRLF with no final newline. Red:2 fail/2 pass. Final outline-order + actual Markdown editing UI regression:32/32 pass.

Real browser after fix: regenerated genuine synthetic outline with two experts; moved published expert down; both groups retained four own questions. Saved draft, aggregate version10; refreshed and verified same group order and own questions. Screenshot31 records persisted result. Isolated ports15410/15420/15425, synthetic input, genuine configured model, no injected model output.
