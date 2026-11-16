# 原生失败私有诊断（零模型费用）

生产改动只有一个有界诊断helper，以及Runtime异常catch增加private log调用。公开error、poll与SSE不增字段，金融classifier和权限不变。诊断只含闭集实际库异常类型、整数状态/errno/SSL代码、合法UUID；cause/context最多6节点，未知类型不执行str/repr/属性钩子；普通日志失败不遮原错误，控制信号继续传播。

现有服务Python实际执行12项stdlib unittest，含真实Runtime._execute与内存HTTPX ASGI poll/SSE逐字检查、secret不进响应、日志sink失败、控制信号、两分支/共享节点/循环/截断。全部通过；三文件编译与源码diff通过。既有pytest全套因工具未安装没有执行；原pytest文件未修改。

命令：在apps/deep-agent-service目录设置PYTHONPATH=src，使用现有运行环境Python执行 `-m unittest discover -s tests -p test_error_diagnostics.py -v`。这是离线测试，不是供应商或课堂验收。未安装包、联网、启栈、调用模型、写入真实财务。
