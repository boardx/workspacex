/* Private bounded FUSE fault server: real FSYNC requests return EIO while
 * the controller-owned flag exists. No host file passthrough or block devices.
 * This models a storage server error, not physical-media persistence or power loss. */
#define FUSE_USE_VERSION 31
#include <fuse3/fuse.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#define MAX_FILES 16
#define MAX_BYTES 65536
struct item { char name[128]; unsigned char data[MAX_BYTES]; size_t size; mode_t mode; };
static struct item files[MAX_FILES];
static const char *fault_flag;
static struct item *find(const char *p) {
    for (int i=0; i<MAX_FILES; i++) if (files[i].name[0] && !strcmp(files[i].name,p)) return &files[i];
    return NULL;
}
static int attributes(const char *p, struct stat *st, struct fuse_file_info *fi) {
    (void)fi; memset(st,0,sizeof(*st)); st->st_uid=getuid(); st->st_gid=getgid();
    if (!strcmp(p,"/")) { st->st_mode=S_IFDIR|0700; st->st_nlink=2; return 0; }
    struct item *f=find(p); if (!f) return -ENOENT;
    st->st_mode=S_IFREG|f->mode; st->st_nlink=1; st->st_size=f->size; return 0;
}
static int create_file(const char *p, mode_t mode, struct fuse_file_info *fi) {
    fi->direct_io=1;
    if (strlen(p)>=sizeof(files[0].name) || p[0]!='/' || strchr(p+1,'/')) return -EINVAL;
    if (find(p)) return -EEXIST;
    for (int i=0;i<MAX_FILES;i++) if (!files[i].name[0]) {
        strcpy(files[i].name,p); files[i].mode=mode&0777; files[i].size=0; return 0;
    }
    return -ENOSPC;
}
static int open_file(const char *p, struct fuse_file_info *fi) {
    fi->direct_io=1; return find(p)?0:-ENOENT;
}
static int read_file(const char *p, char *buf, size_t n, off_t off, struct fuse_file_info *fi) {
    (void)fi; struct item *f=find(p); if (!f) return -ENOENT;
    if (off<0) return -EINVAL; if ((size_t)off>=f->size) return 0;
    if (n>f->size-(size_t)off) n=f->size-(size_t)off;
    memcpy(buf,f->data+off,n); return (int)n;
}
static int write_file(const char *p, const char *buf, size_t n, off_t off, struct fuse_file_info *fi) {
    (void)fi; struct item *f=find(p); if (!f) return -ENOENT;
    if (off<0 || (size_t)off>MAX_BYTES || n>MAX_BYTES-(size_t)off) return -ENOSPC;
    memcpy(f->data+off,buf,n); if ((size_t)off+n>f->size) f->size=(size_t)off+n; return (int)n;
}
static int truncate_file(const char *p, off_t size, struct fuse_file_info *fi) {
    (void)fi; struct item *f=find(p); if (!f) return -ENOENT;
    if (size<0 || size>MAX_BYTES) return -ENOSPC;
    if ((size_t)size>f->size) memset(f->data+f->size,0,(size_t)size-f->size);
    f->size=(size_t)size; return 0;
}
static int sync_file(const char *p, int datasync, struct fuse_file_info *fi) {
    (void)datasync; (void)fi;
    if (access(fault_flag,F_OK)==0) {
        printf("FSYNC_EIO %s\n",p); fflush(stdout); return -EIO;
    }
    printf("FSYNC_OK %s\n",p); fflush(stdout); return 0;
}
static int list_files(const char *p, void *buf, fuse_fill_dir_t fill, off_t off,
                      struct fuse_file_info *fi, enum fuse_readdir_flags flags) {
    (void)off; (void)fi; (void)flags; if (strcmp(p,"/")) return -ENOENT;
    fill(buf,".",NULL,0,0); fill(buf,"..",NULL,0,0);
    for (int i=0;i<MAX_FILES;i++) if(files[i].name[0]) fill(buf,files[i].name+1,NULL,0,0);
    return 0;
}
int main(int argc,char **argv) {
    if (argc!=3) return 2;
    fault_flag=argv[2];
    struct fuse_operations ops={.getattr=attributes,.create=create_file,.open=open_file,
        .read=read_file,.write=write_file,.truncate=truncate_file,.fsync=sync_file,
        .fsyncdir=sync_file,.readdir=list_files};
    char *args[]={argv[0],"-f","-s","-o","default_permissions,nodev,nosuid,noexec,fsname=wsx-fsync-fault",argv[1],NULL};
    return fuse_main(6,args,&ops,NULL);
}
