using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class WorkbenchMediaGuard {
    [StructLayout(LayoutKind.Sequential)] struct BasicLimits {
        public long PerProcessUserTimeLimit, PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass, SchedulingClass;
    }
    [StructLayout(LayoutKind.Sequential)] struct IoCounters {
        public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount;
        public ulong ReadTransferCount, WriteTransferCount, OtherTransferCount;
    }
    [StructLayout(LayoutKind.Sequential)] struct ExtendedLimits {
        public BasicLimits BasicLimitInformation;
        public IoCounters IoInfo;
        public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed;
    }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool SetInformationJobObject(IntPtr job, int kind, ref ExtendedLimits limits, uint length);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();

    static string Quote(string value) {
        var result = new StringBuilder("\"");
        int slashes = 0;
        foreach (char c in value) {
            if (c == '\\') { slashes++; continue; }
            result.Append('\\', c == '"' ? slashes * 2 + 1 : slashes);
            result.Append(c); slashes = 0;
        }
        result.Append('\\', slashes * 2); return result.Append('"').ToString();
    }
    public static int Run(string binary, string[] args, string cwd, ulong memoryLimit) {
        // Shared across Runtime and test processes in this Windows session.
        using (var mutex = new Mutex(false, @"Local\CreativityWorkbenchMedia")) {
            bool acquired;
            try { acquired = mutex.WaitOne(170000); }
            catch (AbandonedMutexException) { acquired = true; }
            if (!acquired) return 124;
            try {
                if (memoryLimit < 268435456 || memoryLimit > 1073741824) return 125;
                var job = CreateJobObject(IntPtr.Zero, null);
                var limits = new ExtendedLimits();
                // JOB_MEMORY | KILL_ON_JOB_CLOSE. Do not allow child breakaway.
                limits.BasicLimitInformation.LimitFlags = 0x200 | 0x2000;
                limits.JobMemoryLimit = new UIntPtr(memoryLimit);
                if (job == IntPtr.Zero || !SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(limits)) || !AssignProcessToJobObject(job, GetCurrentProcess())) {
                    Console.Error.WriteLine("WORKBENCH_MEDIA_GUARD_FAILED"); return 125;
                }
                // Keep the raw job handle until host exit (closing it kills all
                // members, including this host). No unguarded fallback.
                var quoted = Array.ConvertAll(args, Quote);
                var start = new ProcessStartInfo(binary, string.Join(" ", quoted));
                start.UseShellExecute = false; start.CreateNoWindow = true;
                start.RedirectStandardOutput = true; start.RedirectStandardError = true;
                if (!string.IsNullOrEmpty(cwd)) start.WorkingDirectory = cwd;
                using (var child = new Process()) {
                    child.StartInfo = start;
                    child.OutputDataReceived += (sender, e) => { if (e.Data != null) Console.Out.WriteLine(e.Data); };
                    child.ErrorDataReceived += (sender, e) => { if (e.Data != null) Console.Error.WriteLine(e.Data); };
                    child.Start(); child.BeginOutputReadLine(); child.BeginErrorReadLine();
                    try { child.PriorityClass = ProcessPriorityClass.BelowNormal; } catch (InvalidOperationException) { }
                    child.WaitForExit(); return child.ExitCode;
                }
            } finally { mutex.ReleaseMutex(); }
        }
    }
}
